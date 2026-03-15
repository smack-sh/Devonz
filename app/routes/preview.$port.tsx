import { type LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

const PREVIEW_CHANNEL = 'preview-updates';

export async function loader({ params }: LoaderFunctionArgs) {
  const port = params.port;

  if (!port || !/^\d+$/.test(port)) {
    throw new Response('A valid port number is required', { status: 400 });
  }

  return Response.json({ port });
}

export default function PreviewWindow() {
  const { port } = useLoaderData<typeof loader>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');

  /* Handle preview refresh */
  const handleRefresh = useCallback(() => {
    if (iframeRef.current && previewUrl) {
      iframeRef.current.src = '';

      requestAnimationFrame(() => {
        if (iframeRef.current) {
          iframeRef.current.src = previewUrl;
        }
      });
    }
  }, [previewUrl]);

  /* Handle hard refresh with cache-busting for config file changes */
  const handleHardRefresh = useCallback(() => {
    if (iframeRef.current && previewUrl) {
      const url = new URL(previewUrl);
      url.searchParams.set('_t', Date.now().toString());

      iframeRef.current.src = '';

      requestAnimationFrame(() => {
        if (iframeRef.current) {
          iframeRef.current.src = url.toString();
        }
      });
    }
  }, [previewUrl]);

  /* Notify other tabs that this preview is ready */
  const notifyPreviewReady = useCallback(() => {
    if (broadcastChannelRef.current && previewUrl) {
      broadcastChannelRef.current.postMessage({
        type: 'preview-ready',
        previewId: port,
        url: previewUrl,
        timestamp: Date.now(),
      });
    }
  }, [port, previewUrl]);

  useEffect(() => {
    const supportsBroadcastChannel = typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function';

    if (supportsBroadcastChannel) {
      broadcastChannelRef.current = new window.BroadcastChannel(PREVIEW_CHANNEL);

      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data.previewId === port) {
          if (event.data.type === 'hard-refresh') {
            handleHardRefresh();
          } else if (event.data.type === 'refresh-preview' || event.data.type === 'file-change') {
            handleRefresh();
          }
        }
      };
    } else {
      broadcastChannelRef.current = null;
    }

    /* Construct the localhost preview URL from the port */
    const url = `http://localhost:${port}`;
    setPreviewUrl(url);

    if (iframeRef.current) {
      iframeRef.current.src = url;
    }

    notifyPreviewReady();

    return () => {
      broadcastChannelRef.current?.close();
    };
  }, [port, handleRefresh, handleHardRefresh, notifyPreviewReady]);

  return (
    <div className="w-full h-full">
      <iframe
        ref={iframeRef}
        title="Preview"
        className="w-full h-full border-none"
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
        allow="cross-origin-isolated"
        loading="eager"
        onLoad={notifyPreviewReady}
      />
    </div>
  );
}
