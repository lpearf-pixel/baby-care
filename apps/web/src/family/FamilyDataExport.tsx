import { useRef, useState } from 'react';
import type { BabyCareApi } from '../api-client.js';

export function FamilyDataExport({ api }: { api: BabyCareApi }) {
  const downloadingRef = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function download() {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloading(true);
    setMessage(null);

    let objectUrl: string | null = null;
    try {
      const exportFile = await api.exportFamilyData();
      objectUrl = URL.createObjectURL(exportFile.blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = exportFile.filename;
      anchor.hidden = true;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
      setMessage('下载已开始，请在浏览器下载中查看');
    } catch {
      setMessage('下载失败，请稍后重试');
    } finally {
      const urlToRevoke = objectUrl;
      if (urlToRevoke) window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 0);
      downloadingRef.current = false;
      setDownloading(false);
    }
  }

  return (
    <section className="panel family-data-export full-span" aria-labelledby="family-data-export-title">
      <h3 id="family-data-export-title">导出家庭数据</h3>
      <p className="family-data-export-warning">导出文件包含家庭和宝宝的私密护理资料。仅在受信任的设备上下载和保存。</p>
      <button className="primary" type="button" disabled={downloading} onClick={() => void download()}>
        {downloading ? '正在准备下载…' : '下载家庭数据'}
      </button>
      {message ? <p className="inline-message" role="status" aria-live="polite">{message}</p> : null}
    </section>
  );
}
