function inferBaseFromLocation() {
  if (typeof window === "undefined" || !window.location) {
    return "/";
  }

  const { pathname } = window.location;
  if (pathname.endsWith("/")) {
    return pathname;
  }

  const slashIndex = pathname.lastIndexOf("/");
  if (slashIndex < 0) {
    return "/";
  }

  return `${pathname.slice(0, slashIndex + 1)}`;
}

export function resolveBaseUrl() {
  const viteBase =
    typeof import.meta !== "undefined" && import.meta.env && typeof import.meta.env.BASE_URL === "string"
      ? import.meta.env.BASE_URL
      : "";

  if (viteBase) {
    return viteBase.endsWith("/") ? viteBase : `${viteBase}/`;
  }

  return inferBaseFromLocation();
}
