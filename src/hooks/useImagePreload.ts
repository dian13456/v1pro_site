import { useEffect } from "react";

export function useImagePreload(urls: string[]) {
  useEffect(() => {
    const uniqueUrls = Array.from(new Set(urls)).slice(0, 20);
    const loaders = uniqueUrls.map((url) => {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      return img;
    });

    return () => {
      loaders.forEach((img) => {
        img.src = "";
      });
    };
  }, [urls]);
}
