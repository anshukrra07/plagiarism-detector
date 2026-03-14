#!/usr/bin/env python3
"""
Generate 20 test plagiarism pairs and populate the MongoDB database.
Useful for testing the network visualization without running full batch comparisons.

Usage:
    python populate_test_pairs.py
"""

import requests
import json
from datetime import datetime, timedelta
import random

API_BASE_URL = "http://localhost:8000"

# Generate realistic student names
FIRST_NAMES = [
    "Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry",
    "Ivy", "Jack", "Karen", "Liam", "Mia", "Noah", "Olivia", "Patrick",
    "Quinn", "Rachel", "Sam", "Tina", "Uma", "Victor", "Wendy", "Xavier",
    "Yvonne", "Zoe"
]

def generate_pairs():
    """Generate 20 test plagiarism pairs with realistic data."""
    pairs = []
    students = random.sample(FIRST_NAMES, 20)  # Pick 20 unique students
    
    # Create 20 pair scenarios
    scenarios = [
        # High similarity pairs (likely copies)
        {"sim": 0.95, "conf": "High", "flagged": 12, "type": "exact_copy"},
        {"sim": 0.92, "conf": "High", "flagged": 10, "type": "heavy_paraphrase"},
        {"sim": 0.89, "conf": "High", "flagged": 9, "type": "paraphrase"},
        {"sim": 0.87, "conf": "Medium", "flagged": 8, "type": "paraphrase"},
        {"sim": 0.85, "conf": "Medium", "flagged": 7, "type": "light_paraphrase"},
        
        # Medium similarity pairs
        {"sim": 0.78, "conf": "Medium", "flagged": 5, "type": "coincidence"},
        {"sim": 0.76, "conf": "Medium", "flagged": 4, "type": "coincidence"},
        {"sim": 0.72, "conf": "Low", "flagged": 3, "type": "common_source"},
        {"sim": 0.70, "conf": "Low", "flagged": 2, "type": "common_source"},
        {"sim": 0.68, "conf": "Low", "flagged": 2, "type": "common_source"},
        
        # More high similarity
        {"sim": 0.93, "conf": "High", "flagged": 11, "type": "heavy_paraphrase"},
        {"sim": 0.90, "conf": "High", "flagged": 9, "type": "paraphrase"},
        {"sim": 0.86, "conf": "Medium", "flagged": 8, "type": "paraphrase"},
        {"sim": 0.82, "conf": "Medium", "flagged": 6, "type": "coincidence"},
        {"sim": 0.80, "conf": "Low", "flagged": 4, "type": "common_source"},
        
        # Medium-low similarity
        {"sim": 0.75, "conf": "Low", "flagged": 3, "type": "coincidence"},
        {"sim": 0.73, "conf": "Low", "flagged": 2, "type": "common_source"},
        {"sim": 0.71, "conf": "Low", "flagged": 2, "type": "common_source"},
        {"sim": 0.88, "conf": "Medium", "flagged": 7, "type": "paraphrase"},
        {"sim": 0.84, "conf": "Medium", "flagged": 6, "type": "paraphrase"},
    ]
    
    # Create pairs
    idx = 0
    for i in range(0, 20, 2):
        if i + 1 < len(students):
            scenario = scenarios[idx]
            idx += 1
            
            student_a = students[i]
            student_b = students[i + 1]
            similarity = scenario["sim"]
            confidence = scenario["conf"]
            flagged = scenario["flagged"]
            pair_type = scenario["type"]
            
            # Generate timestamps (staggered over last 7 days)
            days_ago = random.randint(0, 7)
            hours_offset = random.randint(0, 23)
            base_time = datetime.utcnow() - timedelta(days=days_ago)
            time_a = base_time - timedelta(hours=random.randint(1, 24))
            time_b = base_time
            
            # Determine copier/original based on timestamps and similarity
            if time_a < time_b:
                original = student_a
                copier = student_b
            else:
                original = student_b
                copier = student_a
            
            # Generate direction signals
            signals = {
                "time": f"{original} submitted {abs((time_b - time_a).total_seconds() / 3600):.1f}h earlier",
                "ownership": f"{original} uses simpler vocabulary — likely original",
                "semantic": f"{copier} flagged {similarity:.0%} vs {original} {(similarity * 0.6):.0%} — {copier} likely copier",
            }
            
            # Generate sample sentence pairs for visualization
            sentence_pairs = [
                {
                    "sentence_a": f"The quick brown fox jumps over the lazy dog in the forest.",
                    "sentence_b": f"A quick brown fox leaps over the lazy dog in the woods.",
                    "similarity": round(similarity, 3),
                    "edit_pct": round((1 - similarity) * 100, 1),
                    "owner": original,
                    "modification": "paraphrase" if similarity < 0.9 else "exact"
                }
            ] if flagged > 0 else []
            
            pair = {
                "student_a": student_a,
                "student_b": student_b,
                "similarity": similarity,
                "flagged_sentences": flagged,
                "copier": copier,
                "original": original,
                "direction_confidence": confidence,
                "direction_signals": signals,
                "is_common_source": pair_type == "common_source",
                "submitted_a": time_a.isoformat() + "Z",
                "submitted_b": time_b.isoformat() + "Z",
                "sentence_pairs": sentence_pairs,
            }
            pairs.append(pair)
    
    return pairs


def populate_database():
    """Send pairs to the API and populate the database."""
    print("🔍 Generating 20 test plagiarism pairs...")
    pairs = generate_pairs()
    
    print(f"\n📊 Generated pairs breakdown:")
    high = sum(1 for p in pairs if p["similarity"] >= 0.87)
    medium = sum(1 for p in pairs if 0.75 <= p["similarity"] < 0.87)
    low = sum(1 for p in pairs if p["similarity"] < 0.75)
    print(f"  - High similarity (≥0.87): {high} pairs")
    print(f"  - Medium similarity (0.75-0.87): {medium} pairs")
    print(f"  - Low similarity (<0.75): {low} pairs")
    
    print(f"\n📤 Sending pairs to {API_BASE_URL}/pairs/batch...")
    
    try:
        response = requests.post(
            f"{API_BASE_URL}/pairs/batch",
            json=pairs,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"\n✅ Success! {result['inserted_count']} pairs added to database")
            print(f"   Message: {result['message']}")
            
            # Show sample pair
            sample = pairs[0]
            print(f"\n📋 Sample pair added:")
            print(f"   {sample['original']} (original) → {sample['copier']} (copier)")
            print(f"   Similarity: {sample['similarity']:.0%}")
            print(f"   Flagged sentences: {sample['flagged_sentences']}")
            
            print(f"\n🌐 View network graph at: http://localhost:3000")
            print(f"   Click 'Network' tab to see the updated visualization")
            
        else:
            print(f"\n❌ Error: {response.status_code}")
            print(f"   Response: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print(f"\n❌ Error: Could not connect to {API_BASE_URL}")
        print(f"   Make sure the backend is running: uvicorn main:app --reload")
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")


if __name__ == "__main__":
    populate_database()
