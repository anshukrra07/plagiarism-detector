export function isExternalSourceUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

export function getSourceDisplay(sentence = {}) {
  const sourceUrl = sentence.source_url || '';
  const rawName = (sentence.source_name || '').trim();
  const normalizedUrl = sourceUrl.toLowerCase();
  const normalizedName = rawName.toLowerCase();

  if (normalizedUrl.startsWith('kaggle://') || normalizedName.startsWith('kaggle:') || normalizedName.startsWith('database:')) {
    return { label: rawName || 'Database', href: null };
  }

  if (isExternalSourceUrl(sourceUrl)) {
    return { label: rawName || 'View source', href: sourceUrl };
  }

  if (rawName) {
    return { label: rawName, href: null };
  }

  return { label: '', href: null };
}
