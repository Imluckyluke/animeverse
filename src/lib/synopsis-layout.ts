/** A toggle is justified by actual wrapped lines, never by character count. */
export function synopsisLayout(naturalHeight: number, lineHeight: number, mobile: boolean) {
  const full = Math.ceil(Math.max(0, naturalHeight));
  const preview = Math.ceil(Math.max(1, lineHeight) * 3);
  const expandable = mobile && naturalHeight > preview + 1;
  return { full, collapsed: expandable ? preview : full, expandable };
}
