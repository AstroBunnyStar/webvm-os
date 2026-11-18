// Desktop wallpapers. Each value is a CSS `background` shorthand applied to #wallpaper.
export const WALLPAPERS = [
  {
    id: "aubergine",
    name: "Aubergine",
    css:
      "radial-gradient(1200px 800px at 78% 12%, rgba(233, 84, 32, 0.55) 0%, rgba(233, 84, 32, 0) 55%), " +
      "radial-gradient(900px 700px at 12% 88%, rgba(119, 33, 111, 0.55) 0%, rgba(119, 33, 111, 0) 60%), " +
      "radial-gradient(1400px 900px at 50% 50%, #3d0f2c 0%, #24001a 45%, #14000f 100%)",
  },
  {
    id: "ember",
    name: "Ember",
    css:
      "radial-gradient(900px 700px at 82% 78%, rgba(233, 84, 32, 0.42) 0%, rgba(233, 84, 32, 0) 62%), " +
      "radial-gradient(1100px 800px at 14% 10%, rgba(249, 196, 64, 0.26) 0%, rgba(249, 196, 64, 0) 58%), " +
      "linear-gradient(160deg, #2a1206 0%, #1a0b05 58%, #120604 100%)",
  },
  {
    id: "mint",
    name: "Mint",
    css:
      "radial-gradient(1000px 700px at 76% 16%, rgba(87, 227, 137, 0.3) 0%, rgba(87, 227, 137, 0) 60%), " +
      "radial-gradient(900px 700px at 18% 86%, rgba(30, 120, 180, 0.36) 0%, rgba(30, 120, 180, 0) 62%), " +
      "linear-gradient(150deg, #04201a 0%, #06161d 58%, #050d10 100%)",
  },
  {
    id: "graphite",
    name: "Graphite",
    css:
      "radial-gradient(1200px 800px at 62% 0%, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 60%), " +
      "linear-gradient(170deg, #2b2b2b 0%, #1b1b1b 55%, #101010 100%)",
  },
];

export const DEFAULT_WALLPAPER = WALLPAPERS[0];

export const wallpaperById = (id) => WALLPAPERS.find((wallpaper) => wallpaper.id === id);
