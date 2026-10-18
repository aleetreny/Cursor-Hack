import { useStore } from '../state/store';

/** Pick a video file from this device and play it in the camera window, analysed live. It is never uploaded. */
let input: HTMLInputElement | null = null;
export function pickVideoFile() {
  if (!input) {
    input = document.createElement('input');
    input.type = 'file'; input.accept = 'video/*'; input.style.display = 'none';
    input.onchange = () => {
      const f = input!.files?.[0];
      if (!f) return;
      const s = useStore.getState();
      if (s.localVideo) URL.revokeObjectURL(s.localVideo.url);
      s.set({ localVideo: { url: URL.createObjectURL(f), name: f.name }, feedOpen: true });
      input!.value = '';
    };
    document.body.appendChild(input);
  }
  input.click();
}
