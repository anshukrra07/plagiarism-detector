# debug_ai.py — prints raw model output to see exact labels
from transformers import pipeline

print("Loading model...")
model = pipeline("text-classification", model="Hello-SimpleAI/chatgpt-detector-roberta",
                 truncation=True, max_length=512)
print("Ready.\n")

texts = [
    "I remember when I first started learning Python, I was completely lost.",
    "Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed.",
]

for t in texts:
    result = model(t)[0]
    print(f"Text:  {t[:60]}...")
    print(f"Raw:   label={repr(result['label'])}  score={result['score']:.4f}")
    print()