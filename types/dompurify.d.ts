// Type declarations for dompurify
// DOMPurify provides its own types, but module resolution may not find them in all configurations
declare module 'dompurify' {
  interface Config {
    ALLOWED_TAGS?: string[];
    ALLOWED_ATTR?: string[];
    ALLOW_DATA_ATTR?: boolean;
    ALLOW_ARIA_ATTR?: boolean;
  }
  
  interface DOMPurifyI {
    sanitize(source: string | Node, config?: Config): string;
  }

  const DOMPurify: DOMPurifyI;
  export = DOMPurify;
}
