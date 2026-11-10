type IconProps = { className?: string };

// Material Symbols `install_mobile` (a phone with a down-arrow), Outlined,
// weight 400 — the same set and style as InstallIcon's `install_desktop`, so
// the two read as one pair. The phone one goes on the [ install_the_app ] CTA,
// which mostly shows on phones; the monitor stays in the desktop install
// hint, where it matches the address-bar glyph. Not DownloadIcon: the floppy
// means "save this set offline".
//
// Path copied verbatim from google/material-design-icons,
// symbols/web/install_mobile/materialsymbolsoutlined/install_mobile_24px.svg.
// Same conventions as InstallIcon: Material's `0 -960 960 960` viewBox,
// 1em sizing so it follows the label's font-size, `currentColor` fill so it
// follows the label's colour and hover, aria-hidden because the label says it.
export function InstallMobileIcon({ className }: IconProps) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M280-40q-33 0-56.5-23.5T200-120v-720q0-33 23.5-56.5T280-920h280v80H280v40h280v80H280v480h400v-80h80v200q0 33-23.5 56.5T680-40H280Zm0-120v40h400v-40H280Zm440-240L520-600l56-56 104 104v-288h80v288l104-104 56 56-200 200ZM280-800v-40 40Zm0 640v40-40Z" />
    </svg>
  );
}
