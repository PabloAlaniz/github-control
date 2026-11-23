export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function appSlugify(repoFullName: string, appName: string): string {
  return `${repoFullName.replace('/', '--')}--${appName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
}
