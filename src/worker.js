// Copyright (c) 2024 Arcesium LLC. Licensed under the BSD 3-Clause License.

let action = chrome.browserAction;

if (chrome.action !== undefined) {
  // running in chrome. Browser action will not work
  action = chrome.action;
}

action.onClicked.addListener(async (tab) => {
  try {
    console.info('Trying to inject Log viewer for Argo Workflows extension:', tab);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['inject.js']
    });

    console.info('Script successfully injected.');
  } catch (error) {
    console.error('Failed to inject script:', error);
  }
});
