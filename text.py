# test_ai_detection.py — Test AI-Generated Content Detection
#
# Run from plagiarism_detector/ folder:
#   python3 test_ai_detection.py
#
# First run downloads roberta-base-openai-detector (~500MB). Cached after that.

from detector.ai_detector import detect_ai_content as detect_ai, ai_result_to_dict

# ── Test texts ────────────────────────────────────────────────────────────────

HUMAN_TEXT = """
I remember when I first started learning Python — I was completely lost. 
The syntax felt weird, the indentation errors drove me crazy, and I kept 
asking my classmates for help. Looking back, the biggest thing that helped 
me was just writing broken code and figuring out why it broke. Nobody teaches 
you that in class. You kind of just have to sit there for an hour staring at 
a missing colon and eventually you start to get it. I'm still not great at 
decorators but honestly I avoid them whenever I can and just write the longer 
version. My professor would probably disagree but it works for me.
"""

AI_TEXT = """
Machine learning is a subset of artificial intelligence that enables systems 
to learn and improve from experience without being explicitly programmed. 
It focuses on developing computer programs that can access data and use it to 
learn for themselves. The process begins with observations or data, such as 
examples, direct experience, or instruction, so that computers can look for 
patterns in data and make better decisions in the future. The primary aim is 
to allow computers to learn automatically without human intervention or assistance 
and adjust actions accordingly. There are several types of machine learning 
algorithms, including supervised learning, unsupervised learning, and reinforcement 
learning, each with distinct characteristics and applications.
"""

MIXED_TEXT = """
I've been studying neural networks for my thesis. Neural networks are computational 
models inspired by the human brain, consisting of interconnected nodes that process 
information in parallel layers. The architecture typically includes an input layer, 
one or more hidden layers, and an output layer, with each connection having an 
associated weight that is adjusted during training.
Honestly the math behind backpropagation still confuses me sometimes, especially 
when I try to do it by hand. I usually just run the code and check the loss curves.
"""

# ── Run tests ─────────────────────────────────────────────────────────────────

tests = [
    ("Human writing (personal anecdote)",   HUMAN_TEXT),
    ("AI writing (textbook-style ML intro)", AI_TEXT),
    ("Mixed (human + AI sentences)",         MIXED_TEXT),
]

print("=" * 65)
print("AI-GENERATED CONTENT DETECTION TEST")
print("Model: roberta-base-openai-detector")
print("=" * 65)

for name, text in tests:
    print(f"\n{'─'*65}")
    print(f"Input: {name}")
    print(f"Text:  \"{text.strip()[:80]}...\"")
    print()

    result = ai_result_to_dict(detect_ai(text))

    print(f"  Label:      {result['label']}")
    print(f"  AI score:   {result['ai_score']:.3f}  ({int(result['ai_score']*100)}% probability of AI)")
    print(f"  Human:      {result['human_score']:.3f} ({int(result['human_score']*100)}% probability of human)")
    print(f"  Confidence: {result['confidence']}")
    print(f"  Verdict:    {result['explanation']}")

print(f"\n{'='*65}")
print("Thresholds:")
print("  >= 0.85  → AI_GENERATED  (High confidence)")
print("  >= 0.70  → LIKELY_AI     (Medium confidence)")
print("  >= 0.45  → UNCERTAIN     (Low confidence)")
print("  >= 0.20  → LIKELY_HUMAN  (Medium confidence)")
print("  <  0.20  → HUMAN         (High confidence)")