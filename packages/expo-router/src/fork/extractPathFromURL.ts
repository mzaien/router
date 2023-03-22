import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Linking from "expo-linking";
import URL from "url-parse";

// This is only run on native.
function extractExactPathFromURL(url: string) {
  if (
    // If a universal link / app link / web URL is used, we should use the path
    // from the URL, while stripping the origin.
    url.match(/^https?:\/\//)
  ) {
    const { origin, href } = new URL(url);
    return href.replace(origin, "");
  }

  // Handle special URLs used in Expo Go: `/--/pathname` -> `pathname`
  if (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient &&
    // while not exhaustive, `exp` and `exps` are the only two schemes which
    // are passed through to other apps in Expo Go.
    url.match(/^exp(s)?:\/\//)
  ) {
    const pathname = url.match(/exps?:\/\/.*?\/--\/(.*)/)?.[1];
    if (pathname) {
      return fromDeepLink("a://" + pathname);
    }

    const res = Linking.parse(url);
    const qs = !res.queryParams
      ? ""
      : Object.entries(res.queryParams)
          .map(([k, v]) => `${k}=${v}`)
          .join("&");
    return (res.path || "") + (qs ? "?" + qs : "");
  }

  // TODO: Support dev client URLs

  return fromDeepLink(url);
}

function fromDeepLink(url: string) {
  // This is for all standard deep links, e.g. `foobar://` where everything
  // after the `://` is the path.
  const res = new URL(url, true);
  const qs = !res.query
    ? ""
    : Object.entries(res.query as Record<string, string>)
        .map(([k, v]) => `${k}=${decodeURIComponent(v)}`)
        .join("&");

  let results = "";

  if (res.host) {
    results += res.host;
  }

  if (res.pathname) {
    results += res.pathname;
  }

  if (qs) {
    results += "?" + qs;
  }

  return results;
}

export function extractExpoPathFromURL(url: string) {
  // TODO: We should get rid of this, dropping specificities is not good
  return extractExactPathFromURL(url).replace(/^\//, "");
}