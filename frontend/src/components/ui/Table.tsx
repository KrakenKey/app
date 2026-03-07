import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes, ReactNode } from 'react';

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

export function Table({ children, className = '', ...props }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm ${className}`} {...props}>
        {children}
      </table>
    </div>
  );
}

interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  children: ReactNode;
}

export function TableHeader({ children, className = '', ...props }: TableHeaderProps) {
  return (
    <thead className={`bg-zinc-900/50 ${className}`} {...props}>
      {children}
    </thead>
  );
}

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  children: ReactNode;
}

export function TableRow({ children, className = '', ...props }: TableRowProps) {
  return (
    <tr
      className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors duration-100 ${className}`}
      {...props}
    >
      {children}
    </tr>
  );
}

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
}

export function TableHead({ children, className = '', ...props }: TableHeadProps) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
}

export function TableCell({ children, className = '', ...props }: TableCellProps) {
  return (
    <td className={`px-4 py-3 text-zinc-300 ${className}`} {...props}>
      {children}
    </td>
  );
}
