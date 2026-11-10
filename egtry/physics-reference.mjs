// New authored books have no v1 index. Old books always keep the live v1 baseline.
export function newBookReference(inventory,book) {
  if(inventory?.schema!=='egtry-physics-track-inventory/1')throw Error('Invalid physics inventory schema');
  if(inventory.books?.some(b=>b.slug===book))return null;
  const record=inventory.new_books?.find(b=>b.slug===book);
  if(!record)return null;
  const slugs=record.chapters?.flatMap(c=>c.pages.map(p=>p.slug))??[];
  if(!slugs.length||new Set(slugs).size!==slugs.length||slugs.some(s=>!/^[-a-z0-9]+$/.test(s)))throw Error('New book needs unique, safe planned slugs');
  return {book,paths:slugs.map(slug=>`/${book}/${slug}/`),title:record.title};
}
