import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
export function LogoCrop({
  src,
  onSave,
  onCancel,
}: {
  src: string;
  onSave: (image: string) => void;
  onCancel: () => void;
}) {
  const [zoom, setZoom] = useState(1),
    [x, setX] = useState(50),
    [y, setY] = useState(50),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function crop() {
    setBusy(true);
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      canvas
        .getContext("2d")!
        .drawImage(
          img,
          ((img.naturalWidth - side) * x) / 100,
          ((img.naturalHeight - side) * y) / 100,
          side,
          side,
          0,
          0,
          512,
          512,
        );
      onSave(canvas.toDataURL("image/png"));
    } catch {
      setError("图片处理失败，请重新选择图片。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          document
            .querySelector<HTMLButtonElement>('button[aria-label="上传企业 Logo"]')
            ?.focus();
        }}
      >
        <DialogTitle className="text-balance">
          裁剪企业 Logo
        </DialogTitle>
        <DialogDescription className="text-pretty">裁为正方形，预览和导出保持一致。</DialogDescription>
        <div className="crop-preview">
          <img
            alt="Logo 裁剪预览"
            src={src}
            style={{
              objectPosition: `${x}% ${y}%`,
              transform: `scale(${zoom})`,
              transformOrigin: `${x}% ${y}%`,
            }}
          />
        </div>
        <label>
          缩放
          <Slider
            aria-label="Logo 缩放"
            min={1}
            max={3}
            step={0.01}
            value={[zoom]}
            onValueChange={([v]) => setZoom(v)}
          />
        </label>
        <label>
          水平位置
          <Slider
            aria-label="Logo 水平位置"
            min={0}
            max={100}
            value={[x]}
            onValueChange={([v]) => setX(v)}
          />
        </label>
        <label>
          垂直位置
          <Slider
            aria-label="Logo 垂直位置"
            min={0}
            max={100}
            value={[y]}
            onValueChange={([v]) => setY(v)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="ui-dialog-actions">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="default" onClick={crop} disabled={busy}>
            {busy ? "处理中…" : "确认裁剪并上传"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
