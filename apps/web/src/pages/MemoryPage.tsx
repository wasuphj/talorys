import { useEffect, useMemo, useState } from "react";
import { MEMORY_CATEGORIES, type Memory, type MemoryCategory, type MemoryReview, type MemoryReviewAction } from "@talorys/shared";
import { Archive, ArchiveRestore, Brain, Clock, GitCompare, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorNotice, Input, Label, PageHeader, Select, Spinner, Textarea } from "../components/ui";
import { type MemoryStatusFilter, useApiMutation, useMemories, useMemoryHistory, useMemoryReviews } from "../hooks/queries";
import { useToast } from "../hooks/toast";
import { api } from "../lib/api";
import { cn, relativeTime } from "../lib/utils";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "선호 사항",
  fact: "사실",
  goal: "목표",
  project: "프로젝트",
  habit: "습관",
  person: "인물",
  other: "기타",
};

const FILTERS: { value: MemoryStatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "active", label: "현재 기억" },
  { value: "historical", label: "과거 이력" },
  { value: "review", label: "검토 필요" },
];

interface WriteResponse {
  memory: Memory;
  superseded?: Memory[];
  reviews?: number;
}

/** Explains what Smart Memory did with a save, in plain words. */
function writeMessage(r: WriteResponse): string {
  const parts = ["기억이 저장되었습니다"];
  if (r.superseded?.length) parts.push(`${r.superseded.length === 1 ? "이전 버전은" : `${r.superseded.length}개의 이전 버전은`} 이력으로 보존되었습니다`);
  if (r.reviews) parts.push("이전 기억과 충돌할 수 있습니다 — 아래에서 검토하세요");
  return parts.join(" · ");
}

const sourceLabel = (m: Memory) => (m.source === "agent" ? "대화에서 학습됨" : m.source === "import" ? "가져옴" : "직접 추가됨");

export default function MemoryPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<MemoryStatusFilter>("all");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading, error, refetch } = useMemories(debounced || undefined, filter);
  const reviews = useMemoryReviews();
  const [editing, setEditing] = useState<Memory | "new" | null>(null);
  const [correcting, setCorrecting] = useState<Memory | null>(null);
  const [historyOf, setHistoryOf] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<MemoryCategory, Memory[]>();
    for (const m of data?.memories ?? []) {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return MEMORY_CATEGORIES.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [data]);

  const remove = useApiMutation((id: string) => api(`/memories/${id}`, { method: "DELETE" }), {
    invalidate: [["memories"]],
    success: "기억이 삭제되었습니다",
    onSuccess: () => setDeleting(null),
  });
  const setStatus = useApiMutation(
    ({ id, status }: { id: string; status: Memory["status"] }) => api(`/memories/${id}/status`, { method: "POST", body: { status } }),
    {
      invalidate: [["memories"]],
      success: "기억이 변경되었습니다",
    },
  );

  const reviewList = reviews.data ?? [];
  const counts = data?.counts;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <PageHeader
        title="기억"
        description={
          <>
            Talorys가 사용자에 대해 기억하는 정보입니다. 대화마다 가장 관련성 높은 현재 기억만 AI에게 전달되며, 과거 이력은 과거에 대해 질문할 때만 활용됩니다.
            {data ? ` 총 ${data.total}개 저장됨.` : ""}
          </>
        }
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> 기억 추가
          </Button>
        }
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1" role="tablist" aria-label="기억 상태">
        {FILTERS.map((f) => {
          const count = f.value === "active" ? counts?.active : f.value === "historical" ? counts?.historical : f.value === "review" ? counts?.review : undefined;
          return (
            <button
              type="button"
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium",
                filter === f.value ? "bg-surface shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {f.label}
              {count ? <span className="ml-1 text-fg-subtle">{count}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="기억 검색" className="pl-9" aria-label="기억 검색" />
      </div>

      {(filter === "review" || filter === "all") && reviewList.length > 0 && <ReviewPanel reviews={reviewList} />}

      {error ? (
        <ErrorNotice error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : grouped.length === 0 ? (
        filter === "review" && reviewList.length > 0 ? null : (
          <EmptyState
            icon={<Brain className="h-9 w-9" />}
            title={debounced ? "일치하는 기억이 없습니다" : filter === "all" ? "아직 저장된 기억이 없습니다" : "항목이 없습니다"}
            action={!debounced && filter === "all" && <Button variant="outline" onClick={() => setEditing("new")}>첫 번째 기억 추가</Button>}
          >
            {debounced
              ? "다른 검색어로 찾아보세요."
              : filter === "historical"
                ? "정보가 변경되면 이전 버전이 여기에 보관됩니다."
                : filter === "review"
                  ? "현재 검토할 충돌 항목이 없습니다."
                  : filter === "active"
                    ? "현재 활성 상태인 기억이 없습니다."
                    : '대화 중에 "아침 회의를 선호한다고 기억해줘"라고 말하거나 여기에 직접 추가할 수 있습니다.'}
          </EmptyState>
        )
      ) : (
        <div className="space-y-8">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                {CATEGORY_LABELS[category]} <span className="ml-1 normal-case tracking-normal">· {items.length}</span>
              </h2>
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                {items.map((m) => (
                  <li key={m.id} className="group flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-[15px] leading-6", m.status === "historical" && "text-fg-muted")}>
                        {m.content}
                        {m.status === "historical" && <Badge className="ml-2 align-middle">과거 이력</Badge>}
                        {m.status === "uncertain" && <Badge tone="warning" className="ml-2 align-middle">불확실</Badge>}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        {sourceLabel(m)} · {relativeTime(m.updated_at)}
                        {m.valid_from && ` · 시작: ${m.valid_from}`}
                        {m.valid_until && ` · 종료: ${m.valid_until}`}
                        {m.superseded_by && (
                          <>
                            {" · "}
                            <button type="button" className="text-accent hover:underline" onClick={() => setHistoryOf(m)}>
                              새로운 기억으로 대체됨
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                      <Button variant="ghost" size="icon" onClick={() => setHistoryOf(m)} aria-label="기억 이력" title="이력">
                        <Clock className="h-4 w-4" />
                      </Button>
                      {m.status !== "historical" && (
                        <Button variant="ghost" size="icon" onClick={() => setCorrecting(m)} aria-label="정보 업데이트" title="변경된 내용 새 버전으로 저장">
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                      {m.status === "historical" ? (
                        <Button variant="ghost" size="icon" onClick={() => setStatus.mutate({ id: m.id, status: "active" })} aria-label="현재 기억으로 복원" title="현재 기억으로 복원">
                          <ArchiveRestore className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" onClick={() => setStatus.mutate({ id: m.id, status: "historical" })} aria-label="과거 이력으로 보관" title="과거 이력으로 보관">
                          <Archive className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => setEditing(m)} aria-label="기억 수정" title="수정">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(m)} aria-label="기억 삭제" title="삭제">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <MemoryEditor memory={editing} onClose={() => setEditing(null)} />
      <CorrectDialog memory={correcting} onClose={() => setCorrecting(null)} />
      <HistoryDialog memory={historyOf} onClose={() => setHistoryOf(null)} />
      <ConfirmDialog
        open={!!deleting}
        title="이 기억을 완전히 삭제할까요?"
        message={
          <>
            “{deleting?.content}” 기억이 영구적으로 삭제됩니다. 과거 사실로 남기려면 '과거 이력으로 보관'을 사용하세요.
          </>
        }
        confirmLabel="삭제"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
      />
    </div>
  );
}

function ReviewPanel({ reviews }: { reviews: MemoryReview[] }) {
  const resolve = useApiMutation(
    ({ id, action }: { id: string; action: MemoryReviewAction }) => api(`/memories/reviews/${id}`, { method: "POST", body: { action } }),
    { invalidate: [["memories"]], success: "완료되었습니다" },
  );
  return (
    <section className="mb-8 space-y-2" aria-label="충돌 가능성 항목">
      <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-fg-subtle">
        <GitCompare className="h-3.5 w-3.5" /> 충돌 가능성 검토 필요 · {reviews.length}개
      </h2>
      {reviews.map((r) => (
        <div key={r.id} className="rounded-xl border border-warning/40 bg-surface px-4 py-3">
          <p className="text-xs text-fg-subtle">{r.reason}</p>
          <dl className="mt-2 grid gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-fg-subtle">최신</dt>
              <dd>{r.memory.content}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-fg-subtle">기존</dt>
              <dd>{r.other.content}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: r.id, action: "keep_both" })}>
              둘 다 유지
            </Button>
            <Button size="sm" onClick={() => resolve.mutate({ id: r.id, action: "mark_historical" })}>
              기존 항목 과거 이력으로
            </Button>
            <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: r.id, action: "replace" })}>
              기존 항목 대체
            </Button>
            <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: r.id, action: "cancel" })}>
              최신 항목 취소
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function HistoryDialog({ memory, onClose }: { memory: Memory | null; onClose: () => void }) {
  const { data, isLoading } = useMemoryHistory(memory?.id ?? null);
  const current = data ? (data.next.at(-1) ?? data.memory) : null;
  const earlier = data ? [...data.previous, ...(data.next.length ? [data.memory, ...data.next.slice(0, -1)] : [])].reverse() : [];
  return (
    <Dialog open={!!memory} onClose={onClose} title="기억 이력">
      {isLoading || !data || !current ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{current.status === "historical" ? "최신 이력" : "현재 기억"}</p>
            <p className="mt-1 leading-6">“{current.content}”</p>
            <p className="text-xs text-fg-subtle">
              {relativeTime(current.created_at)} 저장됨
              {current.valid_from && ` · 시작: ${current.valid_from}`}
            </p>
          </div>
          {earlier.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">이전 버전</p>
              <ul className="mt-1 space-y-2">
                {earlier.map((m) => (
                  <li key={m.id} className="text-fg-muted">
                    “{m.content}”
                    <span className="block text-xs text-fg-subtle">
                      {relativeTime(m.created_at)} 저장됨
                      {m.valid_until && ` · 종료: ${m.valid_until}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-fg-subtle">이전 버전이 없습니다.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Saves a newer version of a fact; the old one is kept as history. */
function CorrectDialog({ memory, onClose }: { memory: Memory | null; onClose: () => void }) {
  const [content, setContent] = useState("");
  const toast = useToast();
  useEffect(() => setContent(memory?.content ?? ""), [memory]);
  const save = useApiMutation(() => api<WriteResponse>(`/memories/${memory!.id}/correct`, { method: "POST", body: { content } }), {
    invalidate: [["memories"]],
    onSuccess: (r) => {
      toast(writeMessage(r));
      onClose();
    },
  });
  return (
    <Dialog
      open={!!memory}
      onClose={onClose}
      title="정보 업데이트"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!content.trim() || content.trim() === memory?.content}>
            새 버전 저장
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">
          상황이나 선호가 변경되었을 때 사용하세요. Talorys는 새 버전을 현재 기억으로 기억하고 “{memory?.content}”는 과거 이력으로 보관합니다.
        </p>
        <div>
          <Label htmlFor="memory-correct">현재 사실은 무엇인가요?</Label>
          <Textarea id="memory-correct" rows={3} value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} autoFocus />
        </div>
      </div>
    </Dialog>
  );
}

function MemoryEditor({ memory, onClose }: { memory: Memory | "new" | null; onClose: () => void }) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("other");
  const toast = useToast();
  useEffect(() => {
    if (memory && memory !== "new") {
      setContent(memory.content);
      setCategory(memory.category);
    } else {
      setContent("");
      setCategory("preference");
    }
  }, [memory]);
  const save = useApiMutation(
    () =>
      memory === "new"
        ? api<WriteResponse>("/memories", { method: "POST", body: { content, category } })
        : api<WriteResponse>(`/memories/${(memory as Memory).id}`, { method: "PATCH", body: { content, category } }),
    {
      invalidate: [["memories"]],
      onSuccess: (r) => {
        toast(writeMessage(r));
        onClose();
      },
    },
  );
  return (
    <Dialog
      open={!!memory}
      onClose={onClose}
      title={memory === "new" ? "기억 추가" : "기억 수정"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!content.trim()}>
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="memory-content">기억할 내용을 입력하세요</Label>
          <Textarea id="memory-content" rows={3} value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} autoFocus placeholder="간결한 답변 선호" />
          {memory !== "new" && memory && (
            <p className="mt-1 text-xs text-fg-subtle">단순 오타 수정은 여기서 하세요. 사실이 변경되었나요? '정보 업데이트'를 사용해 이전 버전을 보관하세요.</p>
          )}
        </div>
        <div>
          <Label htmlFor="memory-category">분류</Label>
          <Select id="memory-category" value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)}>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <Badge tone="accent">Cloudflare 인프라에만 안전하게 저장됩니다</Badge>
      </div>
    </Dialog>
  );
}
