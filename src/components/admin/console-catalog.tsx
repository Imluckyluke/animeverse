"use client";

import type {
  AdminEpisode,
  AdminSession,
  AdminTitle,
  AdminTitleDetail,
  AdminTitlePatch,
} from "@/lib/admin-contract";
import {
  adminErrorMessage,
  getCatalog,
  getTitle,
  isAbortError,
  isUnauthorized,
  patchEpisode,
  patchTitle,
  uploadMedia,
  type AdminCatalogFilter,
} from "@/lib/admin-client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, faNum, initials } from "@/lib/utils";
import {
  Check,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Lock,
  Pin,
  RefreshCw,
  Save,
  SearchX,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BusyButton,
  ConsoleCard,
  ConsoleDialog,
  EmptyState,
  InlineError,
  LoadingRows,
  Pager,
  SearchField,
  SectionHeading,
  StatusChip,
  errorText,
  formatBytes,
  formatDateTime,
  formatNumber,
  useDebouncedValue,
  usePermissions,
  type ConsoleNotice,
} from "@/components/admin/console-ui";

const FILTERS: { key: AdminCatalogFilter; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "hidden", label: "مخفی" },
  { key: "pinned", label: "ویژه" },
  { key: "unpublished", label: "منتشرنشده" },
];

type Draft = {
  title: string;
  titleEn: string;
  titleJa: string;
  year: string;
  studio: string;
  synopsis: string;
  genres: string;
  hidden: boolean;
  pinned: boolean;
  editorScore: string;
  cover: string;
  banner: string;
};

function draftFrom(item: AdminTitle): Draft {
  return {
    title: item.title ?? "",
    titleEn: item.titleEn ?? "",
    titleJa: item.titleJa ?? "",
    year: item.year === null || item.year === undefined ? "" : String(item.year),
    studio: item.studio ?? "",
    synopsis: item.synopsis ?? "",
    genres: (item.genres ?? []).join("، "),
    hidden: Boolean(item.hidden),
    pinned: Boolean(item.pinned),
    editorScore:
      item.editorScore === null || item.editorScore === undefined ? "" : String(item.editorScore),
    cover: item.cover ?? "",
    banner: item.banner ?? "",
  };
}

function splitGenres(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[،,\n]/)
    .map((part) => part.trim())
    .filter((part) => {
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    });
}

function patchFromDraft(draft: Draft, saved: Draft): AdminTitlePatch {
  const patch: AdminTitlePatch = {};
  if (draft.title !== saved.title) patch.title = draft.title.trim();
  if (draft.titleEn !== saved.titleEn) patch.titleEn = draft.titleEn.trim();
  if (draft.titleJa !== saved.titleJa) patch.titleJa = draft.titleJa.trim();
  if (draft.year !== saved.year) patch.year = draft.year.trim() ? Number(draft.year) : null;
  if (draft.studio !== saved.studio) patch.studio = draft.studio.trim();
  if (draft.synopsis !== saved.synopsis) patch.synopsis = draft.synopsis.trim();
  if (draft.genres !== saved.genres) patch.genres = splitGenres(draft.genres);
  if (draft.hidden !== saved.hidden) patch.hidden = draft.hidden;
  if (draft.pinned !== saved.pinned) patch.pinned = draft.pinned;
  if (draft.editorScore !== saved.editorScore) {
    patch.editorScore = draft.editorScore.trim() ? Number(draft.editorScore) : null;
  }
  if (draft.cover !== saved.cover) patch.cover = draft.cover;
  if (draft.banner !== saved.banner) patch.banner = draft.banner;
  return patch;
}

function validateDraft(draft: Draft): string {
  if (!draft.title.trim()) return "عنوان فارسی نمی‌تواند خالی باشد.";
  if (draft.year.trim()) {
    const year = Number(draft.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return "سال باید یک عدد صحیح بین ۱۹۰۰ و ۲۲۰۰ باشد.";
    }
  }
  if (draft.editorScore.trim()) {
    const score = Number(draft.editorScore);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      return "امتیاز تحریریه باید بین ۰ و ۱۰ باشد.";
    }
  }
  return "";
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("خواندن فایل ناموفق بود."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("خواندن فایل ناموفق بود."));
    reader.readAsDataURL(file);
  });
}

function CoverThumb({
  src,
  title,
  className,
  alt,
}: {
  src?: string | null;
  title: string;
  className?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(167,139,250,.35),transparent_60%),linear-gradient(160deg,#241b3b,#100d1a)] text-sm font-black text-white",
          className,
        )}
      >
        {initials(title)}
      </span>
    );
  }
  return (
    // Protected previews are same-origin, so the HttpOnly admin cookie is sent.
    <img
      src={src}
      alt={alt ?? `تصویر ${title}`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}

export function CatalogPanel({
  session,
  onUnauthorized,
  notify,
}: {
  session: AdminSession;
  onUnauthorized: () => void;
  notify: ConsoleNotice;
}) {
  const { canEditCatalog } = usePermissions();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 320);
  const [filter, setFilter] = useState<AdminCatalogFilter>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminTitle[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [serverPage, setServerPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++requestRef.current;
    setError("");
    if (items.length) setRefreshing(true);
    else setLoading(true);

    getCatalog(
      { query: debouncedQuery, page, filter, targets: false },
      controller.signal,
    )
      .then((payload) => {
        if (request !== requestRef.current) return;
        setItems(payload.items ?? []);
        setTotal(payload.total ?? 0);
        setPageSize(payload.pageSize || 20);
        setServerPage(payload.page || 1);
      })
      .catch((failure) => {
        if (isAbortError(failure)) return;
        if (isUnauthorized(failure)) {
          onUnauthorized();
          return;
        }
        setError(adminErrorMessage(failure, "فهرست کاتالوگ دریافت نشد."));
      })
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => controller.abort();
    // items.length is intentionally read once for the initial skeleton only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filter, page, reload, onUnauthorized]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const changeFilter = (next: AdminCatalogFilter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <div className="space-y-3">
      <ConsoleCard className="p-4 sm:p-5">
        <SectionHeading
          icon={<ShieldCheck className="size-4" />}
          title="کاتالوگ عنوان‌ها"
          description="فقط دادهٔ واقعی سرور؛ ویرایش عنوان‌ها و قسمت‌ها پس از ثبت، در انتظار انتشار عمومی می‌ماند."
          action={
            <BusyButton
              type="button"
              busy={refreshing}
              onClick={() => setReload((value) => value + 1)}
              className="btn btn-glass btn-sm"
            >
              <RefreshCw className="size-3.5" />
              به‌روزرسانی
            </BusyButton>
          }
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SearchField
            value={query}
            onChange={changeQuery}
            label="جست‌وجو در کاتالوگ"
            placeholder="عنوان، نام انگلیسی یا اسلاگ…"
            busy={loading || query !== debouncedQuery}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="فیلتر کاتالوگ">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => changeFilter(option.key)}
                aria-pressed={filter === option.key}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[10.5px] font-bold transition-colors",
                  filter === option.key
                    ? "border-amber-400/40 bg-amber-400/12 text-amber-200"
                    : "border-white/10 bg-white/[0.04] text-content-muted hover:text-white",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <StatusChip tone="neutral" className="ms-auto">
            {formatNumber(total)} عنوان
          </StatusChip>
        </div>

        {error ? <InlineError message={error} onRetry={() => setReload((v) => v + 1)} className="mt-3" /> : null}
      </ConsoleCard>

      <ConsoleCard className="overflow-hidden">
        <div aria-busy={loading || refreshing} className="p-2 sm:p-3">
          {loading ? (
            <LoadingRows rows={6} />
          ) : items.length ? (
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.slug}>
                  <button
                    type="button"
                    onClick={() => setSelectedSlug(item.slug)}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-transparent px-2.5 py-2.5 text-right transition-colors hover:border-white/[0.09] hover:bg-white/[0.04] focus-visible:border-amber-400/40"
                    aria-label={`${canEditCatalog ? "ویرایش" : "مشاهدهٔ"} ${item.title || item.titleEn}`}
                  >
                    <CoverThumb
                      src={item.cover}
                      title={item.title || item.titleEn || item.slug}
                      className="h-[62px] w-[44px] shrink-0 rounded-xl border border-white/10"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("truncate text-[12.5px] font-bold text-white", item.hidden && "line-through opacity-70")}>
                          {item.title || item.titleEn || item.slug}
                        </span>
                        {item.pinned ? (
                          <StatusChip tone="amber">
                            <Pin className="size-2.5" />
                            ویژه
                          </StatusChip>
                        ) : null}
                        {item.hidden ? (
                          <StatusChip tone="danger">
                            <EyeOff className="size-2.5" />
                            مخفی
                          </StatusChip>
                        ) : null}
                        {!item.published ? <StatusChip tone="violet">منتشرنشده</StatusChip> : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-content-faint">
                        <span dir="ltr" className="truncate">
                          {item.titleEn || item.slug}
                        </span>
                        {item.year ? <span>{faNum(item.year)}</span> : null}
                        <span className="tabular-nums">
                          {formatNumber(item.readyEpisodes)} قسمت آماده
                          {item.declaredEpisodes !== null ? ` از ${formatNumber(item.declaredEpisodes)}` : ""}
                        </span>
                        <span className="tabular-nums">{formatNumber(item.readyQualities)} کیفیت</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-content-faint">
                        <span>نسخهٔ {formatNumber(item.revision)}</span>
                        {item.updatedAt ? <span>· {formatDateTime(item.updatedAt)}</span> : null}
                        {item.genres?.length ? (
                          <span className="truncate">· {item.genres.slice(0, 4).join("، ")}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 text-[10px] font-bold text-content-muted sm:flex">
                      {canEditCatalog ? "ویرایش" : "مشاهده"}
                      <span className="grid size-8 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-content-soft transition-colors group-hover:border-amber-400/35 group-hover:text-amber-200">
                        {canEditCatalog ? <Save className="size-3.5" /> : <Eye className="size-3.5" />}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : error ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-[11px] leading-6 text-content-faint">
              فهرست کاتالوگ در دسترس نیست؛ خطای بالا را ببینید یا دوباره تلاش کنید.
            </p>
          ) : (
            <EmptyState
              title="عنوانی پیدا نشد"
              description="جست‌وجو یا فیلتر را تغییر دهید. هیچ عنوان ساختگی نمایش داده نمی‌شود."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                    setPage(1);
                  }}
                  className="btn btn-glass btn-sm"
                >
                  <SearchX className="size-3.5" />
                  پاک کردن فیلترها
                </button>
              }
            />
          )}
        </div>
        {items.length ? (
          <div className="border-t border-white/[0.07] px-4 py-3">
            <Pager
              page={serverPage}
              total={total}
              pageSize={pageSize}
              busy={loading || refreshing}
              onPage={setPage}
              label="صفحهٔ کاتالوگ"
            />
          </div>
        ) : null}
      </ConsoleCard>

      {selectedSlug ? (
        <CatalogDetailDialog
          slug={selectedSlug}
          session={session}
          onUnauthorized={onUnauthorized}
          notify={notify}
          onClose={() => setSelectedSlug(null)}
          onSaved={() => setReload((value) => value + 1)}
        />
      ) : null}
    </div>
  );
}

/* ── Detail / editor ───────────────────────────────────────────────────── */

function CatalogDetailDialog({
  slug,
  session,
  onUnauthorized,
  notify,
  onClose,
  onSaved,
}: {
  slug: string;
  session: AdminSession;
  onUnauthorized: () => void;
  notify: ConsoleNotice;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { canEditCatalog } = usePermissions();
  const [detail, setDetail] = useState<AdminTitleDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [note, setNote] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [closeAsk, setCloseAsk] = useState(false);
  const [coverPreview, setCoverPreview] = useState("");
  const [bannerPreview, setBannerPreview] = useState("");
  const [uploading, setUploading] = useState<"cover" | "banner" | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [episodeAction, setEpisodeAction] = useState<{
    episode: number;
    quality: string;
    hidden: boolean;
  } | null>(null);
  const [episodeNote, setEpisodeNote] = useState("");
  const [episodeBusy, setEpisodeBusy] = useState(false);
  const [episodeError, setEpisodeError] = useState("");
  const dirtyRef = useRef(false);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  const dirty = Boolean(draft && savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft));
  dirtyRef.current = dirty;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getTitle(slug, controller.signal)
      .then((payload) => {
        setDetail(payload);
        const fresh = draftFrom(payload.item);
        setSavedDraft(fresh);
        if (!dirtyRef.current || !draftRef.current) {
          setDraft(fresh);
          setCoverPreview(payload.item.cover ?? "");
          setBannerPreview(payload.item.banner ?? "");
        }
      })
      .catch((failure) => {
        if (isAbortError(failure)) return;
        if (isUnauthorized(failure)) {
          onUnauthorized();
          return;
        }
        setError(adminErrorMessage(failure, "جزئیات عنوان دریافت نشد."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, reload, onUnauthorized]);

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSaveError("");
  };

  const guardedClose = () => {
    if (saveBusy || uploading || episodeBusy) return;
    if (dirty) {
      setCloseAsk(true);
      return;
    }
    onClose();
  };

  const save = async () => {
    if (!draft || !savedDraft || !detail || !canEditCatalog) return;
    const validation = validateDraft(draft);
    if (validation) {
      setSaveError(validation);
      return;
    }
    const patch = patchFromDraft(draft, savedDraft);
    if (!Object.keys(patch).length) {
      setSaveError("");
      return;
    }
    const submitted = { ...draft };
    setSaveBusy(true);
    setSaveError("");
    try {
      const result = await patchTitle(
        slug,
        { expectedRevision: detail.revision, patch, note: note.trim() },
        session.csrf,
      );
      setSavedDraft(submitted);
      setDetail((current) =>
        current ? { ...current, revision: result.revision ?? current.revision } : current,
      );
      setNote("");
      setCloseAsk(false);
      notify(
        "تغییرات ذخیره شد",
        "ثبت در سرور انجام شد؛ نمایش عمومی تصویر و اطلاعات جدید فقط پس از انتشار است.",
        "success",
      );
      onSaved();
      setReload((value) => value + 1);
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setSaveError(errorText(failure, "ذخیرهٔ تغییرات ناموفق بود."));
      if (failure instanceof Error && "status" in failure && (failure as { status?: number }).status === 409) {
        setReload((value) => value + 1);
      }
    } finally {
      setSaveBusy(false);
    }
  };

  const upload = async (target: "cover" | "banner", file: File | undefined) => {
    if (!file || !canEditCatalog) return;
    setUploadError("");
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      setUploadError("فقط تصویر JPEG، PNG یا WebP مجاز است.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setUploadError("حجم تصویر باید حداکثر ۳ مگابایت باشد.");
      return;
    }
    setUploading(target);
    try {
      const data = await readFileBase64(file);
      const result = await uploadMedia(
        { data, mime: file.type as "image/jpeg" | "image/png" | "image/webp" },
        session.csrf,
      );
      updateDraft({ [target]: result.url } as Partial<Draft>);
      if (target === "cover") setCoverPreview(result.previewUrl || result.url);
      else setBannerPreview(result.previewUrl || result.url);
      notify(
        "تصویر بارگذاری شد",
        "فایل در پیش‌نمایش محافظت‌شده ثبت شد؛ تصویر جدید فقط پس از انتشار عمومی می‌شود.",
        "info",
      );
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setUploadError(errorText(failure, "بارگذاری تصویر ناموفق بود."));
    } finally {
      setUploading(null);
    }
  };

  const confirmEpisode = async () => {
    if (!episodeAction || !detail || !canEditCatalog) return;
    setEpisodeBusy(true);
    setEpisodeError("");
    try {
      const result = await patchEpisode(
        slug,
        {
          expectedRevision: detail.revision,
          episode: episodeAction.episode,
          quality: episodeAction.quality,
          hidden: episodeAction.hidden,
          note: episodeNote.trim() || "تغییر نمایش کیفیت از پنل مدیریت",
        },
        session.csrf,
      );
      setDetail((current) =>
        current ? { ...current, revision: result.revision ?? current.revision } : current,
      );
      setEpisodeAction(null);
      setEpisodeNote("");
      notify(
        "نمایش کیفیت ثبت شد",
        "تغییر در سرور ذخیره شد و پس از انتشار عمومی اعمال می‌شود.",
        "success",
      );
      onSaved();
      setReload((value) => value + 1);
    } catch (failure) {
      if (isUnauthorized(failure)) {
        onUnauthorized();
        return;
      }
      setEpisodeError(errorText(failure, "ثبت تغییر قسمت ناموفق بود."));
      if (failure instanceof Error && "status" in failure && (failure as { status?: number }).status === 409) {
        setReload((value) => value + 1);
      }
    } finally {
      setEpisodeBusy(false);
    }
  };

  const item = detail?.item;
  const title = item?.title || item?.titleEn || slug;

  return (
    <ConsoleDialog
      open
      onClose={guardedClose}
      title={canEditCatalog ? "ویرایش عنوان" : "جزئیات عنوان"}
      description={slug}
      width="lg"
      closeDisabled={saveBusy || Boolean(uploading) || episodeBusy}
      footer={
        canEditCatalog ? (
          closeAsk ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-amber-200">تغییرات ذخیره‌نشده دارید.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setCloseAsk(false)} className="btn btn-ghost btn-sm">
                  بازگشت به ویرایش
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn btn-sm bg-danger text-[#21070d] hover:bg-[#ff8fa1]"
                >
                  بستن بدون ذخیره
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[180px] flex-1">
                <span className="mb-1 block text-[10.5px] text-content-faint">
                  یادداشت تغییر (اختیاری)
                </span>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="مثلاً: اصلاح عنوان و ژانر"
                  className="field h-10 text-[11.5px]"
                />
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-content-faint" aria-live="polite">
                  {dirty ? "تغییرات ذخیره‌نشده" : "همگام با سرور"}
                </span>
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty || saveBusy || Boolean(uploading)}
                  className="btn btn-primary btn-md"
                >
                  {saveBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {saveBusy ? "در حال ذخیره…" : "ذخیره"}
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-content-faint">دسترسی فقط‌خواندنی برای نقش بازبین</span>
            <button type="button" onClick={onClose} className="btn btn-glass btn-sm">
              بستن
            </button>
          </div>
        )
      }
    >
      <div className="space-y-4 pb-1">
        {error ? <InlineError message={error} onRetry={() => setReload((value) => value + 1)} /> : null}
        {saveError ? <InlineError message={saveError} /> : null}
        {uploadError ? <InlineError message={uploadError} /> : null}

        {loading && !detail ? (
          <div className="space-y-2">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : item && draft && savedDraft ? (
          <>
            <section className="av-sub rounded-2xl p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <CoverThumb
                    src={coverPreview || draft.cover}
                    title={title}
                    className="h-16 w-[46px] shrink-0 rounded-xl border border-white/10"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-black text-white">{title}</p>
                    <p className="truncate text-[10px] text-content-faint" dir="ltr">
                      {slug}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <StatusChip tone={item.published ? "success" : "violet"}>
                        {item.published ? "منتشرشده" : "منتشرنشده"}
                      </StatusChip>
                      <StatusChip tone="neutral">نسخهٔ {formatNumber(detail?.revision ?? item.revision)}</StatusChip>
                      {item.source ? <StatusChip tone="neutral">{item.source}</StatusChip> : null}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReload((value) => value + 1)}
                  className="btn btn-glass btn-sm"
                  disabled={saveBusy}
                >
                  <RefreshCw className="size-3.5" />
                  تازه‌سازی
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[10.5px] sm:grid-cols-4">
                <div className="rounded-xl border border-white/[0.06] px-2.5 py-2">
                  <dt className="text-content-faint">قسمت آماده</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-white">{formatNumber(item.readyEpisodes)}</dd>
                </div>
                <div className="rounded-xl border border-white/[0.06] px-2.5 py-2">
                  <dt className="text-content-faint">کیفیت</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-white">{formatNumber(item.readyQualities)}</dd>
                </div>
                <div className="rounded-xl border border-white/[0.06] px-2.5 py-2">
                  <dt className="text-content-faint">به‌روزرسانی</dt>
                  <dd className="mt-0.5 font-bold text-content-soft">{formatDateTime(item.updatedAt)}</dd>
                </div>
                <div className="rounded-xl border border-white/[0.06] px-2.5 py-2">
                  <dt className="text-content-faint">منبع</dt>
                  <dd className="mt-0.5 truncate font-bold text-content-soft" dir="ltr">
                    {item.source || "—"}
                  </dd>
                </div>
              </dl>
              {item.metadataUrl ? (
                <a
                  href={item.metadataUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-flex text-[10.5px] font-semibold text-violet-300 underline decoration-violet-300/30 underline-offset-4"
                >
                  مشاهدهٔ منبع فراداده
                </a>
              ) : null}
            </section>

            <section className="av-sub rounded-2xl p-3.5">
              <SectionHeading title="اطلاعات تحریریه" description="عنوان، ژانر و امتیاز تحریریه؛ امتیاز مال نیست." />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="عنوان فارسی" required>
                  <input
                    value={draft.title}
                    onChange={(event) => updateDraft({ title: event.target.value })}
                    disabled={!canEditCatalog}
                    className="field h-10 text-[12px]"
                  />
                </Field>
                <Field label="عنوان انگلیسی" ltr>
                  <input
                    value={draft.titleEn}
                    onChange={(event) => updateDraft({ titleEn: event.target.value })}
                    disabled={!canEditCatalog}
                    dir="ltr"
                    className="field h-10 text-[12px]"
                  />
                </Field>
                <Field label="عنوان ژاپنی" ltr>
                  <input
                    value={draft.titleJa}
                    onChange={(event) => updateDraft({ titleJa: event.target.value })}
                    disabled={!canEditCatalog}
                    dir="ltr"
                    className="field h-10 text-[12px]"
                  />
                </Field>
                <Field label="سال">
                  <input
                    type="number"
                    value={draft.year}
                    onChange={(event) => updateDraft({ year: event.target.value })}
                    disabled={!canEditCatalog}
                    min={1900}
                    max={2200}
                    inputMode="numeric"
                    className="field h-10 text-[12px] tabular-nums"
                  />
                </Field>
                <Field label="استودیو">
                  <input
                    value={draft.studio}
                    onChange={(event) => updateDraft({ studio: event.target.value })}
                    disabled={!canEditCatalog}
                    className="field h-10 text-[12px]"
                  />
                </Field>
                <Field label="امتیاز تحریریه (۰ تا ۱۰)" hint="این امتیاز تحریریه است، نه امتیاز MAL.">
                  <input
                    type="number"
                    value={draft.editorScore}
                    onChange={(event) => updateDraft({ editorScore: event.target.value })}
                    disabled={!canEditCatalog}
                    min={0}
                    max={10}
                    step={0.1}
                    inputMode="decimal"
                    className="field h-10 text-[12px] tabular-nums"
                  />
                </Field>
                <Field label="ژانرها" hint="با ویرگول یا ویرگول فارسی جدا کنید.">
                  <input
                    value={draft.genres}
                    onChange={(event) => updateDraft({ genres: event.target.value })}
                    disabled={!canEditCatalog}
                    className="field h-10 text-[12px]"
                  />
                </Field>
                <Field label="نمایش و ویژه" hint="مخفی‌بودن، عنوان را از آرشیو عمومی خارج می‌کند.">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateDraft({ hidden: !draft.hidden })}
                      disabled={!canEditCatalog}
                      aria-pressed={draft.hidden}
                      className={cn(
                        "btn btn-glass btn-sm flex-1",
                        draft.hidden && "border-danger/35 bg-danger/10 text-danger",
                      )}
                    >
                      {draft.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {draft.hidden ? "مخفی" : "قابل نمایش"}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDraft({ pinned: !draft.pinned })}
                      disabled={!canEditCatalog}
                      aria-pressed={draft.pinned}
                      className={cn(
                        "btn btn-glass btn-sm flex-1",
                        draft.pinned && "border-amber-400/35 bg-amber-400/10 text-amber-200",
                      )}
                    >
                      <Pin className="size-3.5" />
                      {draft.pinned ? "ویژه" : "عادی"}
                    </button>
                  </div>
                </Field>
              </div>
              <Field label="خلاصه" className="mt-3">
                <textarea
                  value={draft.synopsis}
                  onChange={(event) => updateDraft({ synopsis: event.target.value })}
                  disabled={!canEditCatalog}
                  rows={5}
                  className="field min-h-[120px] resize-y py-2.5 text-[12px] leading-7"
                />
              </Field>
            </section>

            <section className="av-sub rounded-2xl p-3.5">
              <SectionHeading
                title="تصویر کاور و بنر"
                description="حداکثر ۳ مگابایت؛ JPEG، PNG یا WebP. پیش‌نمایش محافظت‌شده است و تصویر تازه فقط پس از انتشار عمومی می‌شود."
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <MediaEditor
                  label="کاور"
                  value={draft.cover}
                  preview={coverPreview || draft.cover}
                  busy={uploading === "cover"}
                  disabled={!canEditCatalog || Boolean(uploading)}
                  aspect="cover"
                  onUpload={(file) => void upload("cover", file)}
                  onRestore={
                    draft.cover !== savedDraft.cover
                      ? () => {
                          updateDraft({ cover: savedDraft.cover });
                          setCoverPreview(savedDraft.cover);
                        }
                      : undefined
                  }
                />
                <MediaEditor
                  label="بنر"
                  value={draft.banner}
                  preview={bannerPreview || draft.banner}
                  busy={uploading === "banner"}
                  disabled={!canEditCatalog || Boolean(uploading)}
                  aspect="banner"
                  onUpload={(file) => void upload("banner", file)}
                  onRestore={
                    draft.banner !== savedDraft.banner
                      ? () => {
                          updateDraft({ banner: savedDraft.banner });
                          setBannerPreview(savedDraft.banner);
                        }
                      : undefined
                  }
                />
              </div>
            </section>

            <section className="av-sub rounded-2xl p-3.5">
              <SectionHeading
                title="قسمت‌ها و کیفیت‌های واقعی"
                description="فقط قسمت‌ها و کیفیت‌های برگشتی از سرور نمایش داده می‌شوند. برای افزودن لینک تازه، از جریان بازبینی آرشیو استفاده کنید."
                action={<StatusChip tone="neutral">{formatNumber(detail?.episodes.length ?? 0)} قسمت</StatusChip>}
              />
              {detail?.episodes.length ? (
                <div className="mt-3 space-y-2">
                  {detail.episodes.map((episode) => (
                    <EpisodeBlock
                      key={episode.number}
                      episode={episode}
                      canEdit={canEditCatalog}
                      onToggle={(quality, hidden) => {
                        setEpisodeError("");
                        setEpisodeNote("");
                        setEpisodeAction({ episode: episode.number, quality, hidden });
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-2xl border border-dashed border-white/10 px-3 py-5 text-center text-[11px] leading-6 text-content-faint">
                  هیچ قسمت واقعی برای این عنوان برنگشته است. تعداد یا لینک ساختگی اضافه نمی‌شود.
                </p>
              )}

              {episodeAction ? (
                <div className="av-enter mt-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-3">
                  <p className="text-[11.5px] font-bold text-amber-100">
                    {episodeAction.hidden ? "مخفی کردن" : "نمایش"} کیفیت {episodeAction.quality} قسمت{" "}
                    {faNum(episodeAction.episode)}؟
                  </p>
                  <p className="mt-1 text-[10.5px] leading-5 text-content-muted">
                    این تغییر روی سرور ثبت می‌شود. اثر عمومی آن پس از انتشار است.
                  </p>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-[10px] text-content-faint">یادداشت</span>
                    <input
                      value={episodeNote}
                      onChange={(event) => setEpisodeNote(event.target.value)}
                      placeholder="اختیاری"
                      className="field h-9 text-[11px]"
                    />
                  </label>
                  {episodeError ? <InlineError message={episodeError} className="mt-2" /> : null}
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEpisodeAction(null);
                        setEpisodeError("");
                      }}
                      disabled={episodeBusy}
                      className="btn btn-ghost btn-sm"
                    >
                      انصراف
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmEpisode()}
                      disabled={episodeBusy}
                      className="btn btn-primary btn-sm"
                    >
                      {episodeBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      {episodeBusy ? "در حال ثبت…" : "تأیید تغییر"}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <EmptyState
            title="جزئیات در دسترس نیست"
            description="پس از رفع خطا دوباره تلاش کنید."
            action={
              <button type="button" onClick={() => setReload((value) => value + 1)} className="btn btn-glass btn-sm">
                <RefreshCw className="size-3.5" />
                تلاش دوباره
              </button>
            }
          />
        )}
      </div>
    </ConsoleDialog>
  );
}

function Field({
  label,
  hint,
  required,
  ltr,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  ltr?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className={cn("mb-1.5 block text-[10.5px] font-semibold text-content-soft", ltr && "text-right")}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[10px] leading-5 text-content-faint">{hint}</span> : null}
    </label>
  );
}

function MediaEditor({
  label,
  value,
  preview,
  busy,
  disabled,
  aspect,
  onUpload,
  onRestore,
}: {
  label: string;
  value: string;
  preview: string;
  busy: boolean;
  disabled: boolean;
  aspect: "cover" | "banner";
  onUpload: (file: File | undefined) => void;
  onRestore?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold text-content-soft">{label}</span>
        {value ? <StatusChip tone="success">فایل ثبت‌شده</StatusChip> : <StatusChip tone="neutral">بدون تصویر</StatusChip>}
      </div>
      <div
        className={cn(
          "av-media-checker overflow-hidden rounded-xl border border-white/[0.08]",
          aspect === "cover" ? "aspect-[3/2]" : "aspect-[16/9]",
        )}
      >
        {preview ? (
          <img src={preview} alt={`پیش‌نمایش ${label}`} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-content-faint">
            <ImageIcon className="size-6" />
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <label
          className={cn(
            "btn btn-glass btn-sm cursor-pointer",
            (disabled || busy) && "pointer-events-none opacity-50",
          )}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {busy ? "در حال بارگذاری…" : "بارگذاری"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || busy}
            onChange={(event) => {
              onUpload(event.target.files?.[0]);
              event.target.value = "";
            }}
            className="sr-only"
          />
        </label>
        {onRestore ? (
          <button type="button" onClick={onRestore} className="btn btn-ghost btn-sm">
            <X className="size-3.5" />
            بازگردانی قبلی
          </button>
        ) : null}
      </div>
      <p className="mt-2 flex items-start gap-1 text-[9.5px] leading-4 text-content-faint">
        <Lock className="mt-0.5 size-2.5 shrink-0" />
        پیش‌نمایش محافظت‌شده؛ انتشار عمومی پس از انتشار کاتالوگ.
      </p>
    </div>
  );
}

function EpisodeBlock({
  episode,
  canEdit,
  onToggle,
}: {
  episode: AdminEpisode;
  canEdit: boolean;
  onToggle: (quality: string, hidden: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-bold text-white">قسمت {faNum(episode.number)}</p>
        <StatusChip tone="neutral">{formatNumber(episode.qualities.length)} کیفیت</StatusChip>
      </div>
      <ul className="mt-2 space-y-1.5">
        {episode.qualities.map((quality) => {
          const external = /^https?:\/\//i.test(quality.url);
          return (
            <li
              key={`${episode.number}-${quality.label}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] px-2.5 py-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="rounded-lg border border-violet-300/20 bg-violet-400/10 px-2 py-0.5 text-[10px] font-bold text-violet-200">
                  {quality.label}
                </span>
                <span className="text-[10px] tabular-nums text-content-faint">
                  {formatBytes(quality.size)}
                </span>
                {quality.hidden ? <StatusChip tone="danger">مخفی</StatusChip> : null}
                {quality.fileId !== null ? (
                  <span className="text-[9.5px] text-content-faint" dir="ltr">
                    file #{quality.fileId}
                  </span>
                ) : null}
                {external ? (
                  <a
                    href={quality.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[10px] font-semibold text-violet-300 underline decoration-violet-300/30 underline-offset-4"
                  >
                    منبع
                  </a>
                ) : null}
              </div>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => onToggle(quality.label, !quality.hidden)}
                  className={cn(
                    "btn btn-sm",
                    quality.hidden
                      ? "border border-amber-400/30 bg-amber-400/10 text-amber-200"
                      : "btn-glass",
                  )}
                  aria-label={`${quality.hidden ? "نمایش" : "مخفی کردن"} کیفیت ${quality.label} قسمت ${faNum(episode.number)}`}
                >
                  {quality.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  {quality.hidden ? "نمایش" : "مخفی"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
