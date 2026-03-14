# report_generator.py — Generate downloadable PDF plagiarism report
#
# Uses ReportLab. Install: pip install reportlab
#
# Output: a PDF with:
#   - Cover page: overall score, label, confidence, submission date
#   - Section scores table
#   - Sentence-by-sentence breakdown (flagged only)
#   - Source links
#   - AI detection result (if provided)

import io
from datetime import datetime, timezone
from typing   import Optional

from reportlab.lib.pagesizes   import A4
from reportlab.lib.styles      import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units       import cm
from reportlab.lib             import colors
from reportlab.lib.enums       import TA_CENTER, TA_LEFT
from reportlab.platypus        import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak,
)


# ── Colour palette ────────────────────────────────────────────────────────────
RED    = colors.HexColor("#e74c3c")
ORANGE = colors.HexColor("#e67e22")
AMBER  = colors.HexColor("#f39c12")
GREEN  = colors.HexColor("#27ae60")
BLUE   = colors.HexColor("#2980b9")
DARK   = colors.HexColor("#1a1a2e")
GRAY   = colors.HexColor("#7f8c8d")
LGRAY  = colors.HexColor("#f8f9fa")
WHITE  = colors.white


def _label_color(label: str):
    return {
        "HIGH_RISK":   RED,
        "MEDIUM_RISK": ORANGE,
        "LOW_RISK":    AMBER,
        "CLEAN":       GREEN,
    }.get(label, GRAY)


def _score_color(score: float):
    if score >= 70: return RED
    if score >= 40: return ORANGE
    if score >= 20: return AMBER
    return GREEN


# ── Main entry point ──────────────────────────────────────────────────────────

def generate_report(
    result:        dict,          # _doc_result_to_dict() output from api/main.py
    filename:      str = "document",
    ai_result:     Optional[dict] = None,   # ai_result_to_dict() output (optional)
) -> bytes:
    """
    Generate a PDF plagiarism report.

    Args:
        result:    DocumentResult dict from the plagiarism pipeline
        filename:  original document name (shown on cover)
        ai_result: optional AI detection result dict

    Returns:
        PDF bytes — write to file or return as HTTP response
    """
    buf    = io.BytesIO()
    doc    = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm,  bottomMargin=2*cm,
    )
    styles = _build_styles()
    story  = []

    # ── Cover ──────────────────────────────────────────────────────────────
    story += _cover_section(result, filename, styles)
    story.append(PageBreak())

    # ── Section scores ────────────────────────────────────────────────────
    if result.get("section_scores"):
        story += _section_scores(result["section_scores"], styles)
        story.append(Spacer(1, 0.5*cm))

    # ── AI detection ──────────────────────────────────────────────────────
    if ai_result:
        story += _ai_section(ai_result, styles)
        story.append(Spacer(1, 0.5*cm))

    # ── Flagged sentences ─────────────────────────────────────────────────
    story += _flagged_sentences(result.get("sentences", []), styles)

    doc.build(story)
    return buf.getvalue()


# ── Cover section ─────────────────────────────────────────────────────────────

def _cover_section(result: dict, filename: str, styles: dict) -> list:
    label      = result.get("label", "UNKNOWN")
    score      = result.get("overall_score", 0)
    confidence = result.get("confidence", "—")
    flagged    = result.get("flagged_count", 0)
    total      = result.get("total_sentences", 0)
    sub_id     = result.get("submission_id", "—")
    label_col  = _label_color(label)
    score_col  = _score_color(score)

    elements = [
        Paragraph("AI Plagiarism Detector", styles["report_title"]),
        Paragraph("Plagiarism Analysis Report", styles["report_subtitle"]),
        Spacer(1, 0.3*cm),
        HRFlowable(width="100%", thickness=2, color=BLUE),
        Spacer(1, 0.5*cm),
        Paragraph(f"Document: <b>{filename}</b>", styles["body"]),
        Paragraph(
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            styles["body_gray"],
        ),
        Paragraph(f"Submission ID: {sub_id}", styles["body_gray"]),
        Spacer(1, 0.8*cm),
    ]

    # Big score table
    score_data = [[
        Paragraph(f'<font color="{score_col.hexval()}" size="36"><b>{score}%</b></font>', styles["centered"]),
        Paragraph(f'<font color="{label_col.hexval()}" size="16"><b>{label.replace("_", " ")}</b></font>', styles["centered"]),
        Paragraph(f'<b>{flagged}</b> / {total}<br/><font size="9" color="#7f8c8d">sentences flagged</font>', styles["centered"]),
        Paragraph(f'<b>{confidence}</b><br/><font size="9" color="#7f8c8d">confidence</font>', styles["centered"]),
    ]]
    score_table = Table(score_data, colWidths=["*", "*", "*", "*"])
    score_table.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), LGRAY),
        ("BOX",         (0,0), (-1,-1), 1, colors.HexColor("#dee2e6")),
        ("INNERGRID",   (0,0), (-1,-1), 0.5, colors.HexColor("#dee2e6")),
        ("TOPPADDING",  (0,0), (-1,-1), 16),
        ("BOTTOMPADDING",(0,0),(-1,-1), 16),
        ("ALIGN",       (0,0), (-1,-1), "CENTER"),
        ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
        ("ROUNDEDCORNERS", [4]),
    ]))
    elements.append(score_table)
    return elements


# ── Section scores ────────────────────────────────────────────────────────────

def _section_scores(section_scores: dict, styles: dict) -> list:
    elements = [
        Paragraph("Section-wise Breakdown", styles["h2"]),
        Spacer(1, 0.2*cm),
    ]

    rows = [["Section", "Score", "Risk Level"]]
    for section, score in sorted(section_scores.items()):
        risk  = "High Risk" if score >= 50 else "Caution" if score >= 20 else "Safe"
        col   = _score_color(score)
        rows.append([
            section,
            Paragraph(f'<font color="{col.hexval()}"><b>{score:.0f}%</b></font>', styles["centered"]),
            Paragraph(f'<font color="{col.hexval()}">{risk}</font>', styles["centered"]),
        ])

    t = Table(rows, colWidths=["*", 3*cm, 3*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",   (0,0), (-1,0),  BLUE),
        ("TEXTCOLOR",    (0,0), (-1,0),  WHITE),
        ("FONTNAME",     (0,0), (-1,0),  "Helvetica-Bold"),
        ("FONTSIZE",     (0,0), (-1,0),  10),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [WHITE, LGRAY]),
        ("GRID",         (0,0), (-1,-1), 0.5, colors.HexColor("#dee2e6")),
        ("TOPPADDING",   (0,0), (-1,-1), 8),
        ("BOTTOMPADDING",(0,0), (-1,-1), 8),
        ("LEFTPADDING",  (0,0), (-1,-1), 10),
        ("ALIGN",        (1,0), (-1,-1), "CENTER"),
        ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
    ]))
    elements.append(t)
    return elements


# ── AI detection section ──────────────────────────────────────────────────────

def _ai_section(ai_result: dict, styles: dict) -> list:
    score = ai_result.get("ai_percent", 0)
    label = ai_result.get("label", "UNKNOWN")
    expl  = ai_result.get("explanation", "")
    col   = _score_color(score)

    return [
        Paragraph("AI-Generated Content Detection", styles["h2"]),
        Spacer(1, 0.2*cm),
        Paragraph(
            f'AI Score: <font color="{col.hexval()}"><b>{score}% — {label.replace("_", " ")}</b></font>',
            styles["body"],
        ),
        Paragraph(expl, styles["body_gray"]),
    ]


# ── Flagged sentences ─────────────────────────────────────────────────────────

def _flagged_sentences(sentences: list, styles: dict) -> list:
    flagged = [s for s in sentences if s.get("label") != "ORIGINAL"]
    if not flagged:
        return [Paragraph("No sentences were flagged.", styles["body_gray"])]

    elements = [
        Paragraph("Flagged Sentences", styles["h2"]),
        Paragraph(
            f"{len(flagged)} sentence(s) flagged for plagiarism.",
            styles["body_gray"],
        ),
        Spacer(1, 0.3*cm),
    ]

    for i, s in enumerate(flagged, 1):
        label    = s.get("label", "UNKNOWN")
        score    = int(s.get("score", 0) * 100)
        conf     = s.get("confidence", "—")
        src_url  = s.get("source_url", "unknown")
        expl     = s.get("explanation", "")
        matched  = s.get("matched_source", "")
        sentence = s.get("sentence", "")
        col      = {"EXACT": RED, "SEMANTIC": ORANGE, "PARAPHRASE": AMBER}.get(label, GRAY)

        row_data = [[
            Paragraph(
                f'<b>#{i}</b> &nbsp;<font color="{col.hexval()}"><b>[{label} — {score}%]</b></font>'
                f' &nbsp;<font size="8" color="#7f8c8d">Confidence: {conf}</font>',
                styles["body"],
            )
        ]]
        header_table = Table(row_data, colWidths=["*"])
        header_table.setStyle(TableStyle([
            ("BACKGROUND",   (0,0), (-1,-1), colors.HexColor("#f8f9fa")),
            ("LEFTPADDING",  (0,0), (-1,-1), 8),
            ("TOPPADDING",   (0,0), (-1,-1), 6),
            ("BOTTOMPADDING",(0,0), (-1,-1), 6),
            ("BOX",          (0,0), (-1,-1), 1, col),
            ("LINEAFTER",    (0,0), (0,-1),  3, col),
        ]))
        elements.append(header_table)

        # Student sentence
        elements.append(Paragraph(
            f'<b>Student:</b> <i>"{sentence}"</i>', styles["flagged_sentence"],
        ))

        # Matched source
        if matched:
            elements.append(Paragraph(
                f'<b>Matched:</b> <i>"{matched[:200]}{"…" if len(matched)>200 else ""}"</i>',
                styles["matched_sentence"],
            ))

        # Explanation
        if expl:
            elements.append(Paragraph(f'<b>Reason:</b> {expl}', styles["body_small"]))

        # Source link
        if src_url and src_url != "unknown":
            elements.append(Paragraph(
                f'<b>Source:</b> <link href="{src_url}"><font color="#2980b9">{src_url}</font></link>',
                styles["body_small"],
            ))

        elements.append(Spacer(1, 0.3*cm))

    return elements


# ── Style definitions ─────────────────────────────────────────────────────────

def _build_styles() -> dict:
    base = getSampleStyleSheet()

    def ps(name, **kw) -> ParagraphStyle:
        return ParagraphStyle(name, parent=base["Normal"], **kw)

    return {
        "report_title":    ps("rt",  fontSize=24, textColor=DARK, alignment=TA_CENTER, spaceAfter=6, fontName="Helvetica-Bold"),
        "report_subtitle": ps("rs",  fontSize=13, textColor=GRAY, alignment=TA_CENTER, spaceAfter=4),
        "h2":              ps("h2",  fontSize=14, textColor=DARK, spaceBefore=12, spaceAfter=6, fontName="Helvetica-Bold"),
        "body":            ps("b",   fontSize=10, textColor=DARK, spaceAfter=4, leading=14),
        "body_gray":       ps("bg",  fontSize=9,  textColor=GRAY, spaceAfter=4, leading=13),
        "body_small":      ps("bs",  fontSize=8,  textColor=GRAY, spaceAfter=3, leading=12),
        "centered":        ps("c",   fontSize=10, alignment=TA_CENTER),
        "flagged_sentence":ps("fs",  fontSize=9,  textColor=DARK, leftIndent=8,  spaceAfter=3, leading=13, backColor=colors.HexColor("#fff9f0")),
        "matched_sentence":ps("ms",  fontSize=9,  textColor=GRAY, leftIndent=8,  spaceAfter=3, leading=13, backColor=colors.HexColor("#f0f4f8")),
    }