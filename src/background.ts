const viewerUrl = (file?: string): string => {
  const base = chrome.runtime.getURL("viewer.html");
  return file ? `${base}?file=${encodeURIComponent(file)}` : base;
};

chrome.action.onClicked.addListener((tab) => {
  // If the current tab is already showing a PDF, open it in the reader directly.
  const url = tab.url ?? "";
  const looksLikePdf = /\.pdf($|[?#])/i.test(url);
  void chrome.tabs.create({ url: viewerUrl(looksLikePdf ? url : undefined) });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-aloud-pdf-link",
    title: "Read aloud with Kokoro",
    contexts: ["link"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== "read-aloud-pdf-link") return;
  const target = info.linkUrl ?? info.pageUrl;
  if (target) void chrome.tabs.create({ url: viewerUrl(target) });
});
