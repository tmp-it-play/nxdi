"use client";

import { Children, type ReactNode, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function paginationPages(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}

function pageBounds(page: number, pageSize: number, totalItems: number) {
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  return {
    startIndex,
    endIndex,
    startItem: totalItems === 0 ? 0 : startIndex + 1,
    endItem: endIndex
  };
}

function matchesSearch(text: string, query: string) {
  const normalizedText = text.toLocaleLowerCase();
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => normalizedText.includes(term));
}

export function PaginationControls({
  disabled = false,
  label,
  page,
  pageSize,
  totalItems,
  onPageChange
}: {
  disabled?: boolean;
  label: string;
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const pages = paginationPages(page, totalPages);
  const bounds = pageBounds(page, pageSize, totalItems);
  let previousRenderedPage = 0;

  return (
    <nav className="pagination" aria-label={label}>
      <p>
        {bounds.startItem}-{bounds.endItem} / {totalItems}
      </p>
      <div className="pagination-controls">
        <button
          aria-label="이전 페이지"
          className={cx("pagination-button icon", page === 1 && "disabled")}
          disabled={disabled || page === 1}
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((item) => {
          const hasGap = previousRenderedPage > 0 && item - previousRenderedPage > 1;
          previousRenderedPage = item;
          return (
            <span className="pagination-page-group" key={item}>
              {hasGap ? <span className="pagination-ellipsis">...</span> : null}
              <button
                aria-current={item === page ? "page" : undefined}
                disabled={disabled}
                className={cx("pagination-button", item === page && "active")}
                type="button"
                onClick={() => onPageChange(item)}
              >
                {item}
              </button>
            </span>
          );
        })}
        <button
          aria-label="다음 페이지"
          className={cx("pagination-button icon", page === totalPages && "disabled")}
          disabled={disabled || page === totalPages}
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}

export function PaginatedList({
  children,
  className,
  id,
  label,
  pageSize
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  label: string;
  pageSize: number;
}) {
  const items = Children.toArray(children).filter(Boolean);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, totalPages);
  const bounds = pageBounds(currentPage, pageSize, items.length);

  return (
    <>
      <section className={cx("list", className)} id={id}>
        {items.slice(bounds.startIndex, bounds.endIndex)}
      </section>
      <PaginationControls
        label={label}
        page={currentPage}
        pageSize={pageSize}
        totalItems={items.length}
        onPageChange={setPage}
      />
    </>
  );
}

export function PaginatedPanelTable({
  children,
  className,
  colSpan,
  emptyText,
  footerRows,
  header,
  id,
  label,
  panelClassName,
  panelHeader,
  pageSize,
  search
}: {
  children: ReactNode;
  className?: string;
  colSpan: number;
  emptyText: string;
  footerRows?: ReactNode;
  header: ReactNode;
  id?: string;
  label: string;
  panelClassName?: string;
  panelHeader: ReactNode;
  pageSize: number;
  search?: {
    ariaLabel: string;
    noResultsText?: string;
    placeholder: string;
    texts: string[];
  };
}) {
  const rows = Children.toArray(children).filter(Boolean);
  const stickyRows = Children.toArray(footerRows).filter(Boolean);
  const [query, setQuery] = useState("");
  const filteredRows = search && query.trim()
    ? rows.filter((_row, index) => matchesSearch(search.texts[index] ?? "", query))
    : rows;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, totalPages);
  const bounds = pageBounds(currentPage, pageSize, filteredRows.length);
  const visibleRows = filteredRows.slice(bounds.startIndex, bounds.endIndex);
  const noRowsText = rows.length === 0
    ? emptyText
    : search?.noResultsText ?? "검색 결과가 없습니다.";

  return (
    <>
      <section className={cx("panel", panelClassName)} id={id}>
        {search ? (
          <div className="paginated-panel-toolbar">
            {panelHeader}
            <div className="panel-table-search">
              <Search aria-hidden="true" size={16} />
              <input
                aria-label={search.ariaLabel}
                autoComplete="off"
                placeholder={search.placeholder}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
              {query ? (
                <button
                  aria-label="검색어 지우기"
                  className="panel-table-search-clear"
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPage(1);
                  }}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </div>
        ) : panelHeader}
        <div className={cx("table-wrap", className)}>
          <table>
            <thead>{header}</thead>
            <tbody>
              {filteredRows.length > 0 ? visibleRows : (
                <tr>
                  <td colSpan={colSpan}>{noRowsText}</td>
                </tr>
              )}
              {stickyRows}
            </tbody>
          </table>
        </div>
      </section>
      <PaginationControls
        label={label}
        page={currentPage}
        pageSize={pageSize}
        totalItems={filteredRows.length}
        onPageChange={setPage}
      />
    </>
  );
}
