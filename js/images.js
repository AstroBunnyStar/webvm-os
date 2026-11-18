// Bootable 32-bit x86 images bundled with the site.
export const IMAGES = [
  {
    id: "alpine",
    name: "Alpine Linux 3.21 — console + apk",
    url: "media/alpine-virt-x86.iso",
    size: "48 MB",
    note: "Text console, package manager, Python, compilers. Install a desktop with the steps in the Desktop app.",
    graphical: false,
  },
  {
    id: "slitaz",
    name: "SliTaz — graphical X11 desktop",
    url: "media/slitaz-rolling.iso",
    size: "59 MB",
    note: "Boots straight into a real X11 desktop: Openbox, panel, desktop icons, file manager, browser.",
    graphical: true,
  },
];

export const DEFAULT_IMAGE = IMAGES[0];

export const imageByUrl = (url) => IMAGES.find((image) => image.url === url);
export const imageName = (url) => (imageByUrl(url)?.name || url).replace(/ — .*/, "");
