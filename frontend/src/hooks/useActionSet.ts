import { useState, useCallback, useMemo } from 'react';

export function useActionSet<T>() {
  const [ids, setIds] = useState<Set<T>>(new Set());

  const add = useCallback((id: T) => {
    setIds((prev) => {
      if (prev.has(id)) return prev;
      return new Set(prev).add(id);
    });
  }, []);

  const remove = useCallback((id: T) => {
    setIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const has = useCallback((id: T) => ids.has(id), [ids]);

  return useMemo(() => ({ ids, add, remove, has }), [ids, add, remove, has]);
}
