# cluster.py — Semantic cluster detection using DBSCAN
# FIX [MEDIUM]: detect_clusters() was writing a temp file per student just to call
#               extractor.extract(), then immediately deleting it.
#               Text is already a string — direct sent_tokenize() is 10-50x faster.

from dataclasses import dataclass, field
from typing import Optional
import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import normalize
from detector.embedder import encode
from detector.extractor import filter_cited_sentences


@dataclass
class SentenceClusterEntry:
    student:    str
    sentence:   str
    cluster_id: int

@dataclass
class CollaborationRing:
    cluster_id:       int
    students:         list[str]
    risk:             str
    sample_sentences: list[str]

@dataclass
class ClusterResult:
    rings:            list[CollaborationRing]
    student_clusters: dict
    total_clusters:   int
    noise_sentences:  int
    all_entries:      list[SentenceClusterEntry]


def detect_clusters(
    texts:  list[str],
    labels: list[str],
    eps:    float = 0.22,
    min_samples: int = 2,
) -> ClusterResult:
    if len(texts) != len(labels):
        raise ValueError("texts and labels must be the same length")
    if len(texts) < 2:
        raise ValueError("Need at least 2 students to detect clusters")

    import nltk
    nltk.download("punkt", quiet=True)
    nltk.download("punkt_tab", quiet=True)
    from nltk.tokenize import sent_tokenize

    all_sentences: list[str] = []
    all_owners:    list[str] = []

    for text, label in zip(texts, labels):
        # FIX [MEDIUM]: was writing a NamedTemporaryFile per student just to call extract().
        # Text is already a string — tokenise directly. Removes all temp-file I/O.
        try:
            raw_sents = sent_tokenize(text)
            sents_raw = [s.strip() for s in raw_sents if len(s.split()) >= 5]
            sents, _  = filter_cited_sentences(sents_raw)
        except Exception:
            sents = [s.strip() for s in text.split('.') if len(s.strip()) > 20]

        for s in sents:
            all_sentences.append(s)
            all_owners.append(label)

    if not all_sentences:
        return ClusterResult(rings=[], student_clusters={}, total_clusters=0,
                             noise_sentences=0, all_entries=[])

    embeddings = encode(all_sentences)
    embeddings = normalize(embeddings, norm='l2')

    db         = DBSCAN(eps=eps, min_samples=min_samples, metric='cosine').fit(embeddings)
    labels_arr = db.labels_

    from collections import defaultdict
    cluster_to_entries: dict = defaultdict(list)
    all_entries = []

    for sentence, owner, cid in zip(all_sentences, all_owners, labels_arr):
        entry = SentenceClusterEntry(student=owner, sentence=sentence, cluster_id=int(cid))
        all_entries.append(entry)
        if cid != -1:
            cluster_to_entries[int(cid)].append(entry)

    rings: list[CollaborationRing] = []
    for cid, entries in cluster_to_entries.items():
        student_set = set(e.student for e in entries)
        if len(student_set) < 2: continue
        samples, seen = [], set()
        for e in entries:
            if e.student not in seen:
                samples.append(e.sentence[:120] + ('…' if len(e.sentence) > 120 else ''))
                seen.add(e.student)
        n    = len(student_set)
        risk = 'HIGH' if n >= 4 else 'MEDIUM' if n == 3 else 'LOW'
        rings.append(CollaborationRing(cluster_id=cid, students=sorted(student_set),
                                       risk=risk, sample_sentences=samples))

    RISK_ORDER = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
    rings.sort(key=lambda r: (RISK_ORDER.get(r.risk, 3), -len(r.students)))

    student_clusters: dict = defaultdict(list)
    for entry in all_entries:
        if entry.cluster_id != -1:
            if entry.cluster_id not in student_clusters[entry.student]:
                student_clusters[entry.student].append(entry.cluster_id)

    noise_count = sum(1 for e in all_entries if e.cluster_id == -1)
    return ClusterResult(rings=rings, student_clusters=dict(student_clusters),
                         total_clusters=len(cluster_to_entries),
                         noise_sentences=noise_count, all_entries=all_entries)


def cluster_result_to_dict(result: ClusterResult) -> dict:
    return {
        'total_clusters':   result.total_clusters,
        'noise_sentences':  result.noise_sentences,
        'rings': [{
            'cluster_id':       r.cluster_id,
            'students':         r.students,
            'student_count':    len(r.students),
            'risk':             r.risk,
            'sample_sentences': r.sample_sentences,
        } for r in result.rings],
        'student_clusters': result.student_clusters,
        'node_cluster_map': _build_node_cluster_map(result),
    }

def _build_node_cluster_map(result: ClusterResult) -> dict:
    node_map = {}
    for student, cluster_ids in result.student_clusters.items():
        node_map[student] = min(cluster_ids)
    for entry in result.all_entries:
        if entry.student not in node_map:
            node_map[entry.student] = -1
    return node_map