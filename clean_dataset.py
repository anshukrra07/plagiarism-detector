import pandas as pd
import re
import nltk
from nltk.corpus import stopwords

nltk.download("stopwords")

# Load dataset
df = pd.read_csv("academic_misconduct_dataset.csv")

print("Original size:", len(df))

# Remove missing answers
df = df.dropna(subset=["student_answer"])

# Remove duplicate submissions
df = df.drop_duplicates(subset=["student_answer"])

# Remove very short texts
df = df[df["student_answer"].str.len() > 40]

# Clean text
def clean_text(text):
    text = text.lower()
    text = re.sub(r"http\S+", "", text)      # remove URLs
    text = re.sub(r"[^a-zA-Z0-9\s]", "", text) # remove symbols
    text = re.sub(r"\s+", " ", text)         # remove extra spaces
    return text.strip()

df["clean_answer"] = df["student_answer"].apply(clean_text)

print("Clean dataset size:", len(df))

# Save cleaned dataset
df.to_csv("clean_academic_dataset.csv", index=False)

print("Clean dataset saved.")