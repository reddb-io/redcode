function paginationWindow(page, pageCount, size = 5) {
  const count = Math.max(1, Math.floor(pageCount));
  const span = Math.max(1, Math.min(count, Math.floor(size)));
  const current = Math.min(count, Math.max(1, Math.floor(page)));
  const first = Math.min(count - span + 1, Math.max(1, current - Math.floor((span - 1) / 2)));
  return Array.from({ length: span }, (_, index) => {
    const value = first + index;
    return value === current ? { page: value, current: true } : { page: value };
  });
}
function validatePagination(pages, reportsPages) {
  if (reportsPages) return;
  const missing = pages.find((item) => !item.href);
  if (missing) throw new Error(`Pagination page ${missing.page} needs an href, or the Pagination needs a page-change callback`);
}
function paginationSteps(pages, pageCount) {
  const listed = pages.map((item) => item.page);
  const current = pages.find((item) => item.current)?.page ?? listed[0] ?? 1;
  const last = pageCount ?? (listed.length ? Math.max(...listed) : current);
  return {
    current,
    previous: current > 1 ? current - 1 : null,
    next: current < last ? current + 1 : null
  };
}
export {
  paginationSteps,
  paginationWindow,
  validatePagination
};
