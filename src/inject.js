// Copyright (c) 2024 Arcesium LLC. Licensed under the BSD 3-Clause License.

console.log('Injecting Log Viewer for Argo Workflows...');

const WORKFLOW_REGEX = /^https?:\/\/(.*)\/workflows\/(.*)\/([a-zA-Z0-9-]+)\?.*$/;
const ARGO_GENERIC_REGEX = /^https?:\/\/(.*)\/workflows\/([a-z0-0-]*)\??\/?.*$/;

let logViewingArea;
let activeTab = 'Getting Started';

// Stores the text content of all tabs
const logContent = {
  'Getting Started':
    "Please open a workflow page (/workflows/<namespace>/<workflow-name>/) to view logs. Then click on the 'Fetch Logs' button to view logs."
};

// Abort controllers to cancel the request listening for logs in case a tab is closed.
const logListenerAbortControllers = {};

// Abort controllers to cancel the request listening for workflow status updates (pending, running, completed) etc.
const statusUpdateAbortControllers = {};

const tabStatusMap = {};

let globalRequestAbortController;

const updateLogContent = (tabName, content) => {
  logContent[tabName] = content;
  window.localStorage.setItem('logContent', JSON.stringify(logContent));
};

const deleteLogContent = (tabName) => {
  delete logContent[tabName];
  window.localStorage.setItem('logContent', JSON.stringify(logContent));
};

const showFooter = () => {
  const footerContainer = document.getElementById('logFooter');
  footerContainer.style.display = 'block';
};

const hideFooter = () => {
  const footerContainer = document.getElementById('logFooter');
  footerContainer.style.display = 'none';
};

const addFloatingButton = () => {
  const injectLogsButton = document.createElement('button');
  injectLogsButton.classList.add('argo-button', 'argo-button--special');
  injectLogsButton.innerText = 'Open Logs';
  injectLogsButton.style.marginLeft = '15px';
  injectLogsButton.style.position = 'fixed';
  injectLogsButton.style.right = '10px';
  injectLogsButton.style.bottom = '50px';
  document.body.appendChild(injectLogsButton);

  injectLogsButton.addEventListener('click', showFooter);
};

const showSnackbar = (message) => {
  const snackBar = document.getElementById('snackbar');
  snackBar.className = 'show';
  snackBar.innerText = message;
  setTimeout(function () {
    snackBar.className = snackBar.className.replace('show', '');
  }, 3000);
};

const setStatusListening = () => {
  const successStatus = document.getElementById('liveStatus');
  const idleStatus = document.getElementById('idleStatus');

  successStatus.style.display = 'block';
  idleStatus.style.display = 'none';
};

const setStatusIdle = () => {
  const successStatus = document.getElementById('liveStatus');
  const idleStatus = document.getElementById('idleStatus');

  successStatus.style.display = 'none';
  idleStatus.style.display = 'block';
};

function addLineBreakIfNeeded(str) {
  if (!/\r?\n$/.test(str)) {
    return str + '\n';
  }
  return str;
}

const registerEventListeners = () => {
  logViewingArea = document.getElementById('textarea');
  const resizeHandle = document.getElementById('resizeHandle');
  const footer = document.getElementById('logFooter');

  const resizeFooter = (e) => {
    if (isResizing) {
      footer.style.height = `${window.innerHeight - e.clientY}px`;
    }
  };

  // Event listeners for resizing
  resizeHandle.addEventListener('mousedown', (_) => {
    isResizing = true;
    document.addEventListener('mousemove', resizeFooter);
  });

  document.addEventListener('mouseup', (_) => {
    isResizing = false;
    document.removeEventListener('mousemove', resizeFooter);
  });

  switchTab = (clickedTab) => {
    const tabName = clickedTab.innerText;
    activeTab = tabName;
    logViewingArea.value = logContent[activeTab] ?? 'Could not find logs for ' + activeTab;
    document
      .querySelectorAll('.log-viewer-tab')
      .forEach((t) => t.classList.remove('log-viewer-tab-active'));
    clickedTab.parentElement.classList.add('log-viewer-tab-active');
    if (logListenerAbortControllers[tabName]) {
      setStatusListening();
    } else {
      setStatusIdle();
    }
  };

  dismissTab = (clickedTab) => {
    const parent = clickedTab.parentElement;
    const tabName = parent.querySelector('.log-viewer-tab-name').innerText;
    console.log('Deleting ', tabName);

    const currentlyActiveTab = parent.classList.contains('log-viewer-tab-active');

    // clean up pending requests and resources
    deleteLogContent(tabName);
    parent.remove();

    if (logListenerAbortControllers[tabName] !== undefined) {
      logListenerAbortControllers[tabName].abort();
    }
    delete logListenerAbortControllers[tabName];

    if (statusUpdateAbortControllers[tabName] !== undefined) {
      statusUpdateAbortControllers[tabName].abort();
    }
    delete statusUpdateAbortControllers[tabName];

    // Switch to a different tab if it was the currently active tab.
    if (currentlyActiveTab) {
      const tabList = document.querySelectorAll('.log-viewer-tab:not(.tab-template)');
      if (tabList.length == 0) {
        // There are no more tabs remaining
        logViewingArea.value = 'Please select a tab.';
        activeTab = '';
        setStatusIdle();
      } else {
        // Switch to the last remaining tab
        switchTab(tabList[tabList.length - 1].querySelector('.log-viewer-tab-name'));
      }
    }
  };

  // add event listeners for tabs
  document.querySelectorAll('.log-tab > .log-viewer-tab-name').forEach((t) => {
    t.addEventListener('click', () => switchTab(t));
  });
  document.querySelectorAll('.log-tab > .log-viewer-tab-icon').forEach((t) => {
    t.addEventListener('click', () => dismissTab(t));
  });

  logViewingArea.value = logContent[activeTab];

  // override typing input in order to save the value in localStorage
  logViewingArea.addEventListener('input', function () {
    const tabName = Array.from(
      document.querySelectorAll('.log-viewer-tab.log-viewer-tab-active > .log-viewer-tab-name')
    ).innerText;
    updateLogContent(tabName, this.value);
  });

  const autoScrollSwitch = document.getElementById('autoScrollSwitch');
  autoScrollSwitch.addEventListener('change', (event) => {
    if (event.target.checked) {
      logViewingArea.scrollTop = logViewingArea.scrollHeight;
    }
  });
  const setTabStatus = (workflowName, status) => {
    const tabName = Array.from(document.querySelectorAll('.log-viewer-tab-name')).filter(
      (t) => t.innerText.trim() == workflowName
    )[0];
    const tab = tabName.parentElement;
    tab.querySelectorAll('i.status-icon').forEach((i) => (i.style.display = 'none'));
    const icon = tab.querySelector(`i.${status.toLowerCase()}`);

    icon.style.display = 'block';
    tabStatusMap[workflowName] = status.toLowerCase();
  };

  const downloadTextContentAsFile = () => {
    const fileName = `${activeTab}.txt`;
    const fileToDownload = new Blob([logViewingArea.value], { type: 'text/plain' });
    const url = URL.createObjectURL(fileToDownload);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', fileName);
    a.click();
  };

  document.getElementById('downloadButton').addEventListener('click', downloadTextContentAsFile);

  const createNewTab = (newFileName, updateContent = true) => {
    const templateTab = document.querySelector('.tab-template');
    const newTab = templateTab.cloneNode(true);
    newTab.classList.remove('tab-template');
    newTab.style.display = 'flex';
    newTab.title = newFileName;
    const tabName = newTab.querySelector('.log-viewer-tab-name');
    tabName.innerText = newFileName;
    tabName.addEventListener('click', () => switchTab(tabName));

    const dismissButton = newTab.querySelector('.log-viewer-tab-icon');
    dismissButton.addEventListener('click', () => dismissTab(dismissButton));

    templateTab.parentElement.appendChild(newTab);
    if (updateContent) {
      updateLogContent(newFileName, 'Waiting for logs...');
    }
    switchTab(newTab.querySelector('.log-viewer-tab-name'));
    newTab.scrollIntoView();
  };

  const startLogListener = async (namespace, workflowName) => {
    try {
      const apiURL = `${window.location.origin}/api/v1/workflows/${namespace}/${workflowName}/log?logOptions.container=main&grep=&logOptions.follow=true`;
      let controller = new AbortController();
      logListenerAbortControllers[workflowName] = controller;
      setStatusListening();
      const response = await fetch(apiURL, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal
      });
      const decoder = new TextDecoder();
      let incompleteChunk = '';
      let result = '...';

      // we are getting a streamed response of json objects in this API. (live)
      // Have to parse json and append to textarea. JSON might be spread over multiple chunks
      // something like
      // chunk 1: {"content": "hello"
      // chunk 2: , "time":
      // chunk 3: "12:23\n"}
      // chunk 4: {"content": " world", "time": "12:24"}\n{"content": ".\n", "time": "12:25"}
      for await (const chunk of response.body) {
        text = decoder.decode(chunk);
        lines = text.split('\n').filter((c) => c != '');

        if (incompleteChunk && lines.length !== 0) {
          lines[0] = incompleteChunk + lines[0];
          incompleteChunk = '';
        }
        let lastLine = lines.slice(-1);
        if (lastLine.length !== 0) {
          lastLine = lastLine[0];
        }
        try {
          JSON.parse(lastLine);
        } catch (e) {
          incompleteChunk = lastLine;
          lines.pop();
        }

        lines = lines.map((currentLine) => {
          let output;
          try {
            output = JSON.parse(currentLine);
            output = output.result.content;
          } catch (e) {
            console.error(`Failed to parse ${currentLine} as JSON. Error details: `, e);
            return currentLine;
          }
          return output;
        });

        result += addLineBreakIfNeeded(lines.join('\n'));
        updateLogContent(workflowName, result);
        const diff =
          logViewingArea.scrollTop + logViewingArea.clientHeight - logViewingArea.scrollHeight;

        // auto-scrolling logic and update text area content only if the tab is currently live
        if (
          document.querySelector('.log-viewer-tab.log-viewer-tab-active > .log-viewer-tab-name')
            .innerText == workflowName
        ) {
          logViewingArea.value = result;
          if (autoScrollSwitch.checked && Math.abs(diff) < 5) {
            logViewingArea.scrollTop = logViewingArea.scrollHeight;
          }
        }
      }
      console.log('Fetching is complete for workflow: .', workflowName);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Fetching logs stopped for workflow: ', workflowName);
      } else {
        console.error('Error occurred while listening for logs:', error);
        throw error;
      }
    }
  };

  const startWorkflowStatusListener = async (namespace, workflowName) => {
    try {
      const apiURL = `${window.location.origin}/api/v1/workflow-events/${namespace}?listOptions.fieldSelector=metadata.namespace=${namespace},metadata.name=${workflowName}`;
      let controller = new AbortController();
      statusUpdateAbortControllers[workflowName] = controller;
      // TODO : Update workflow status unknown
      const response = await fetch(apiURL, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal
      });
      const decoder = new TextDecoder();

      let incompleteChunk = '';

      for await (const chunk of response.body) {
        text = decoder.decode(chunk);
        if (incompleteChunk && text.trim()) {
          text = incompleteChunk + text;
          incompleteChunk = '';
        }

        try {
          JSON.parse(text);
        } catch (e) {
          incompleteChunk = text;
          continue;
        }
        let parsedStatus;
        try {
          parsedStatus = JSON.parse(text);
        } catch (e) {
          console.log(`Failed to parse ${text}. error: `, e);
          continue;
        }
        const status = parsedStatus.result.object.status.phase;
        setTabStatus(workflowName, status);
      }
      console.log('Monitoring is complete for workflow: ', workflowName);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Status monitoring stopped for workflow: ', workflowName);
      } else {
        console.error('Error in status monitoring API:', error);
        throw error;
      }
    }
  };

  const fetchLogs = (namespace, workflowName, shouldSwitch = true) => {
    const newFileName = workflowName;

    if (logContent[newFileName] === undefined) {
      createNewTab(newFileName);
      updateLogContent(newFileName, 'Waiting for logs...');
    } else if (shouldSwitch) {
      switchTab(
        Array.from(document.querySelectorAll('.log-viewer-tab-name')).filter(
          (x) => x.innerText == newFileName
        )[0]
      );
    }

    // stop listenining, if already active
    if (logListenerAbortControllers[newFileName] !== undefined) {
      logListenerAbortControllers[newFileName].abort();
    }
    // start listening
    startLogListener(namespace, workflowName);
    startWorkflowStatusListener(namespace, workflowName);
  };

  const openTabFromUrl = async () => {
    const currentUrl = window.location.href;
    const match = currentUrl.match(WORKFLOW_REGEX);
    if (!match) {
      showSnackbar('Please open an active workflow page to start listening for logs.');
      return;
    }
    const namespace = match[2];
    const workflowName = match[3];

    fetchLogs(namespace, workflowName);
  };

  const startListeningForNewWorkflows = async (namespace) => {
    try {
      const apiURL = `${window.location.origin}/api/v1/workflow-events/${namespace}?listOptions.fieldSelector=metadata.namespace=${namespace}&listOptions.labelSelector=workflows.argoproj.io/phase%20in%20(Running,Pending)&fields=result.object.metadata.name`;
      globalRequestAbortController = new AbortController();
      const response = await fetch(apiURL, {
        method: 'GET',
        credentials: 'include',
        signal: globalRequestAbortController.signal
      });

      const decoder = new TextDecoder();

      for await (const chunk of response.body) {
        text = decoder.decode(chunk);

        try {
          parsedEvent = JSON.parse(text);
          const workflowName = parsedEvent.result.object.metadata.name;

          const userInput = document.querySelector('#workflowPattern');
          const pattern = userInput.value;

          if (pattern && workflowName.startsWith(pattern)) {
            if (logListenerAbortControllers[workflowName] === undefined) {
              showSnackbar(`Starting to listen to new workflow: ${workflowName}`);
              fetchLogs(namespace, workflowName, false);
            }
          }
          // fetchLogs(namespace, workflowName, false);
        } catch (e) {
          console.log('Failed to parse. error: ', e);
        }
      }
      console.log('Monitoring is complete for workflow: .', workflowName);
    } catch (error) {
      console.error('Error monitoring API:', error);
      throw error;
    }
  };

  document.getElementById('fetchLogsButton').addEventListener('click', openTabFromUrl);

  const toggleWordWrap = (event) => {
    logViewingArea.style.whiteSpace = event.target.checked ? 'pre-wrap' : 'pre';
  };
  document.getElementById('wordWrapSwitch').addEventListener('change', toggleWordWrap);

  document.getElementById('dismissFooterButton').addEventListener('click', () => {
    footer.style.display = 'none';
  });

  const recoverTabs = () => {
    const existingLogContent = window.localStorage.getItem('logContent');
    if (existingLogContent) {
      const parsedLogContent = JSON.parse(existingLogContent);
      for (const [key, value] of Object.entries(parsedLogContent)) {
        if (key !== 'Getting Started' && logContent[key] === undefined) {
          if (key) {
            logContent[key] = value;
            createNewTab(key, false);
            setTabStatus(key, 'unknown');
          }
        }
      }
    }
  };
  document.querySelector('#recoverTabsButton').addEventListener('click', recoverTabs);

  const deleteAllInactiveTabs = () => {
    const tabs = document.querySelectorAll('.log-viewer-tab-name');

    tabs.forEach((tab) => {
      const tabName = tab.innerText;

      if (
        tabName !== 'Getting Started' &&
        tabName.trim() !== 'sample-tab' &&
        (tabStatusMap[tabName] === undefined || tabStatusMap[tabName] !== 'running')
      ) {
        delete tabStatusMap[tabName];
        dismissTab(tab.parentElement.querySelector('.log-viewer-tab-icon'));
      }
    });
  };

  document.getElementById('deleteAllTabsButton').addEventListener('click', deleteAllInactiveTabs);
  document.getElementById('autoListenerSwitch').addEventListener('click', (e) => {
    const userInput = document.querySelector('#workflowPattern');
    if (e.target.checked) {
      if (!userInput.value) {
        showSnackbar('Please specify a starting / prefix pattern for workflow name.');
        e.target.checked = false;
        return;
      }

      const currentUrl = window.location.href;
      const match = currentUrl.match(ARGO_GENERIC_REGEX);
      if (!match || match.length < 3) {
        showSnackbar('Please select a namespace.');
        return;
      }
      const namespace = match[2];

      startListeningForNewWorkflows(namespace);
    } else {
      globalRequestAbortController.abort();
    }
  });
};

async function fetchAssetFileContent(path) {
  try {
    const response = await fetch(chrome.runtime.getURL(path));
    if (!response.ok) {
      throw new Error(`Failed to fetch content: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    throw new Error(`Error loading content from ${path}: ${error.message}`);
  }
}

const injectHtml = async () => {
  try {
    // If a button with the class "argo-button" exists, we safely assume we are currently in Argo Workflows UI
    const argoButton = document.querySelector('.argo-button');
    if (argoButton === null) {
      const response = confirm(
        'Could not detect Argo Workflows UI in the current page. Do you still want to inject?'
      );
      if (!response) {
        return;
      }
    }
    const htmlContent = await fetchAssetFileContent('html/injected_footer.html');

    // insert the loaded HTML at the end of current DOM tree
    const div = document.createElement('div');
    div.innerHTML = htmlContent;
    document.body.appendChild(div);

    registerEventListeners();
    hideFooter();
    addFloatingButton();
  } catch (error) {
    console.error('Error injecting HTML:', error);
  }
};

const injectStylesheet = async () => {
  try {
    const cssContent = await fetchAssetFileContent('css/styles.css');
    const styleElement = document.createElement('style');
    styleElement.innerHTML = cssContent;
    document.head.appendChild(styleElement);
  } catch (error) {
    console.error('Error injecting stylesheet:', error);
  }
};

injectStylesheet();
injectHtml();

console.log('Injected Log Viewer for Argo Workflows.');
