import { useCallback, useEffect, useRef, useState } from "react";
import { LIST_PAGE_SIZE } from "../services/cometchat";

// Loads a list page by page from a request made by `createRequest`
// (anything with fetchNext()). A new request is made whenever `deps` change
// or reload() is called; responses from an old request are ignored.
export function usePagedList(createRequest, deps) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef(null);
  const busyRef = useRef(false);

  const load = useCallback(async (request, append) => {
    busyRef.current = true;
    try {
      const page = await request.fetchNext();
      if (requestRef.current !== request) return;
      setItems((prev) => (append ? [...prev, ...page] : page));
      setHasMore(page.length === LIST_PAGE_SIZE);
      setError(null);
    } catch (e) {
      if (requestRef.current === request) setError(e);
    } finally {
      if (requestRef.current === request) {
        setLoading(false);
        busyRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    const request = createRequest();
    requestRef.current = request;
    setLoading(true);
    load(request, false);
    // createRequest is usually an inline arrow; `deps` say when it really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken, load]);

  const loadMore = useCallback(() => {
    if (!busyRef.current && requestRef.current) load(requestRef.current, true);
  }, [load]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  return { items, setItems, loading, error, hasMore, loadMore, reload };
}
