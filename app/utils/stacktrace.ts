/**
 * Cleans runtime preview URLs from stack traces to show relative paths instead.
 * Handles both localhost URLs (local runtime) and legacy webcontainer-api.io URLs.
 */
export function cleanStackTrace(stackTrace: string): string {
  const cleanUrl = (url: string): string => {
    /* Match localhost preview URLs: http://localhost:PORT/path */
    const localhostRegex = /^https?:\/\/localhost:\d+(\/.*)?$/;

    if (localhostRegex.test(url)) {
      const pathRegex = /^https?:\/\/localhost:\d+\/(.*?)$/;
      const match = url.match(pathRegex);

      return match?.[1] || '';
    }

    /* Match legacy webcontainer-api.io URLs */
    const wcRegex = /^https?:\/\/[^/]+\.webcontainer-api\.io(\/.*)?$/;

    if (wcRegex.test(url)) {
      const pathRegex = /^https?:\/\/[^/]+\.webcontainer-api\.io\/(.*?)$/;
      const match = url.match(pathRegex);

      return match?.[1] || '';
    }

    return url;
  };

  return stackTrace
    .split('\n')
    .map((line) => {
      /* Match any URL in the line that contains localhost:PORT or webcontainer-api.io */
      return line
        .replace(/(https?:\/\/localhost:\d+\/[^\s)]+)/g, (match) => cleanUrl(match))
        .replace(/(https?:\/\/[^/]+\.webcontainer-api\.io\/[^\s)]+)/g, (match) => cleanUrl(match));
    })
    .join('\n');
}
