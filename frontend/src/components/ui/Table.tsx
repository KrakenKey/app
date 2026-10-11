import type {
  HTMLAttributes,
  ThHTMLAttributes,
  TdHTMLAttributes,
  ReactNode,
} from 'react';

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

export function Table({ children, className = '', ...props }: TableProps) {
  return (
    <div className="relative overflow-x-auto">
      <table
        className={`w-full text-sm [&_tbody>tr:last-child]:border-b-0 ${className}`}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  children: ReactNode;
}

/** Table head. Pass `TableHead` cells; they are wrapped in one row. */
export function TableHeader({
  children,
  className = '',
  ...props
}: TableHeaderProps) {
  return (
    <thead className={`border-b border-border-subtle ${className}`} {...props}>
      <tr>{children}</tr>
    </thead>
  );
}

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  children: ReactNode;
}

export function TableRow({
  children,
  className = '',
  ...props
}: TableRowProps) {
  return (
    <tr
      className={`border-b border-border-subtle hover:bg-white/[0.025] transition-colors duration-100 ${className}`}
      {...props}
    >
      {children}
    </tr>
  );
}

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
}

export function TableHead({
  children,
  className = '',
  ...props
}: TableHeadProps) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-[11px] font-medium text-text-faint uppercase tracking-[0.06em] whitespace-nowrap ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
}

export function TableCell({
  children,
  className = '',
  ...props
}: TableCellProps) {
  return (
    <td
      className={`px-4 py-3 text-text-secondary align-middle ${className}`}
      {...props}
    >
      {children}
    </td>
  );
}
