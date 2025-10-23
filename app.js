const ipcFrame = document.querySelectorAll('iframe')[0];
const appFrame = document.querySelectorAll('iframe')[1];

const ipcWin = ipcFrame.contentWindow;
const appWin = appFrame.contentWindow;

const ipc = window.ipc = {
    target: ipcWin,
    _send: (data) => {
        ipc.target.postMessage(JSON.stringify(data), '*');
    },
    indicate: (channel, data) => {
        ipc._send({
            type: 'indicate',
            channel,
            data
        });
    },
    _nonce: 0,
    ask: (channel, data) => {
        return new Promise(resolve => {
            const current = ipc._nonce;
            ipc._nonce += 1;
            /** @param {MessageEvent} event */
            const listener = event => {
                if(event.source !== ipc.target) return;
                const data = JSON.parse(event.data);
                if(data.type !== 'answer') return;
                if(data.nonce !== current) return;
                if(data.channel !== channel) return;
                window.removeEventListener('message', listener);
                resolve(data.data);
            };
            window.addEventListener('message', listener);
            ipc._send({
                type: 'ask',
                nonce: current,
                channel,
                data
            });
        });
    },
    when: (channel, handler) => {
        window.addEventListener('message', async event => {
            if(event.source !== ipc.target) return;
            const data = JSON.parse(event.data);
            if(data.type !== 'ask') return;
            if(data.channel !== channel) return;
            const result = await handler({
                type: 'AskEvent',
                channel: data.channel,
                data: data.data,
                raw: event.data
            });
            ipc._send({
                type: 'answer',
                nonce: data.nonce,
                channel: data.channel,
                data: result
            });
        });
    },
    on: (channel, action) => {
        window.addEventListener('message', event => {
            if(event.source !== ipc.target) return;
            const data = JSON.parse(event.data);
            if(data.type !== 'indicate') return;
            if(data.channel !== channel) return;
            action({
                type: 'IndicateEvent',
                data: data.data,
                channel: data.channel,
                raw: event.data
            });
        });
    }
};

let nnCapable = false;

const nn = class Notification {
    title;
    /**
     * 
     * @param {string} title 
     * @param {{
     *  body?: string,
     *  image?: string
     * }} options 
     */
    constructor(title, options = { }) {
        this.title = title;
        this.options = options;
        ipc.indicate('nn-show', { title, options });
    }
    close() {
        ipc.indicate('nn-close');
    }
};

nn.permission = 'granted';

nn.requestPermission = async (e) => {
    if(nnCapable) {
        e('granted');
        return 'granted';
    }
    ipc.indicate('nn-uncapable');
};

// So they know the app isn't frozen
ipc.when('ping', _ => Promise.resolve('pong'));

ipc.when('ready', event => {
    let lsCache = event.data.ls;
    nnCapable = event.data.nnCapable;
    const lDaemon = new Proxy(window.localStorage, {
        get: (target, key) => {
            if(key === 'length') return Object.keys(lsCache).length;
            if(key === 'key') {
                return (index) => {
                    return Object.keys(lsCache)[index];
                };
            }
            if(key === 'getItem') {
                return (item) => {
                    return lsCache[item] || null
                };
            }
            if(key === 'setItem') {
                return (key, value) => {
                    lsCache[key] = String(value);
                    ipc.indicate('ls-set', { key, value });
                };
            }
            if(key === 'removeItem') {
                return (key) => {
                    lsCache[key] = undefined;
                    ipc.indicate('ls-rm', { key });
                };
            }
            if(key === 'clear') {
                return (key) => {
                    lsCache = { };
                    ipc.indicate('ls-clear', { });
                }
            }
            return lsCache[key] || null;
        },
        set: (target, key, value) => {
            lsCache[key] = value;
            ipc.indicate('ls-set', { key, value });
        },
        deleteProperty: (target, key) => {
            lsCache[key] = undefined;
            ipc.indicate('ls-rm', { key });
        }
    });
    return new Promise(resolve => {
        appFrame.src = "/app";
        appFrame.onerror = () => {
            resolve();
        };
        appFrame.onload = () => {
            resolve();
            appWin.ipc = ipc;
            appWin.Notification = nn;
            Object.defineProperty(appWin, 'localStorage', {
                value: lDaemon,
                configurable: true
            });
            // media
            const ogFetch = appWin.fetch;
            appWin.fetch = function(url, ...args) {
                if(typeof url !== 'string') {
                    // probably a request
                    return ogFetch(url, ...args);
                }
                if(url.startsWith('https://cdn.discordapp.com/attachments/')) {
                     return ogFetch(`/gmedia?url=${encodeURIComponent(url)}`, ...args);
                }
            };
            // file picker
            const ogOnClick = HTMLInputElement.prototype.click;
            const ogShowPicker = HTMLInputElement.prototype.showPicker;
            Object.defineProperty(appWin.HTMLInputElement.prototype, 'click', {
                value: function (...args) {
                    if(this.type === 'file') {
                        ipc.ask('file-picker', {}).then(result => {
                            if(result.ok) {
                                const transfer = new DataTransfer();
                                result.files.forEach(entry => {
                                    const file = new File([ new Uint8Array(entry.buffer) ], entry.name);
                                    transfer.items.add(file);
                                    this.files = transfer.files;
                                });
                                this.dispatchEvent(new Event("change", { bubbles: true }));
                            }
                        });
                    } else {
                        return ogOnClick.apply(this, [ ...args ]);
                    }
                }
            });
            Object.defineProperty(appWin.HTMLInputElement.prototype, 'showPicker', {
                value: function (...args) {
                    if(this.type === 'file') {
                        ipc.ask('file-picker', {}).then(result => {
                            if(result.ok) {
                                const transfer = new DataTransfer();
                                result.files.forEach(entry => {
                                    const file = new File([ entry.buffer ], entry.name);
                                    transfer.items.add(file);
                                    this.files = transfer.files;
                                });
                            }
                        });
                    } else {
                        return ogShowPicker.apply(this, [ ...args ]);
                    }
                }
            });
            // focus on click
            // Handle downloads
            appWin.eval(`(${_ => {
                window.addEventListener('click', event => {
                    const picker = event.target.closest('input[type="file"]');
                    if(picker) {
                        event.preventDefault();
                        // redirect to us
                        picker.showPicker();
                    }
                });
                window.addEventListener('mousedown', _ => ipc.indicate('mouse-down'));
                const listener = event => {
                    // Discord wants to do something with the link
                    if(event.defaultPrevented) return;
                    // get the closest link
                    const target = event.target.closest('a');
                    if(target && target.href && !target.href.startsWith('/') && !target.href.startsWith('#')) {
                        if(target.download) {
                            event.stopPropagation();
                            event.preventDefault();
                            ipc.indicate('clicked-link', {
                                type: 'download',
                                url: target.href,
                                filename: target.download
                            });
                        } else if(target.target === '_blank') {
                            event.stopPropagation();
                            event.preventDefault();
                            // these automatically download when opened in your browser
                            if(target.href.startsWith('https://cdn.discordapp.com/attachments/')) {
                                // this is how we get the name
                                const url = new URL(target.href);
                                const fname = url.pathname.split('/')[4];
                                ipc.indicate('clicked-link', {
                                    type: 'download',
                                    url: target.href,
                                    filename: fname || 'unknown'
                                });
                            } else {
                                // Any other link
                                ipc.indicate('clicked-link', {
                                    type: 'launch',
                                    url: target.href
                                });
                            }
                        }
                    }
                };
                window.addEventListener('click', listener);
                // Downloads at images are links that
                // aren't attached to the DOM
                const ogClickLink = HTMLAnchorElement.prototype.click;
                Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
                    value: function () {
                        if(this.target === '_blank' || this.download || this.url.startsWith('https://cdn.discordapp.com/')) {
                            this.onclick = listener;
                        };
                        return ogClickLink.apply(this);
                    }
                });
                let tb_i = setInterval(() => {
                    const those = document.querySelector('div.trailing_c38106');
                    if(!those) return;
                    clearInterval(tb_i);
                    // fake buttons for padding
                    const buttonsOutline = document.createElement('div');
                    buttonsOutline.innerHTML = '<div class="winButton_c38106 winButtonMinMax_c38106" aria-label="Minimize" tabindex="-1" role="button"><svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6"></rect></svg></div><div class="winButton_c38106 winButtonMinMax_c38106" aria-label="Maximize" tabindex="-1" role="button"><svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12"><rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor"></rect></svg></div><div class="winButton_c38106 winButtonClose_c38106 winButton_c38106" aria-label="Close" tabindex="-1" role="button"><svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12"><polygon fill="currentColor" fill-rule="evenodd" points="11 1.576 6.583 6 11 10.424 10.424 11 6 6.583 1.576 11 1 10.424 5.417 6 1 1.576 1.576 1 6 5.417 10.424 1"></polygon></svg></div>';
                    buttonsOutline.className = 'winButtons_c38106 winButtonsWithDivider_c38106';
                    those.appendChild(buttonsOutline);
                    buttonsOutline.style.opacity = '0';
                    // real buttons
                    const buttons = document.createElement('div');
                    buttons.innerHTML = '<div class="winButton_c38106 winButtonMinMax_c38106" aria-label="Minimize" tabindex="-1" role="button"><svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6"></rect></svg></div><div class="winButton_c38106 winButtonMinMax_c38106" aria-label="Maximize" tabindex="-1" role="button"><svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12"><rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor"></rect></svg></div><div class="winButton_c38106 winButtonClose_c38106 winButton_c38106" aria-label="Close" tabindex="-1" role="button"><svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12"><polygon fill="currentColor" fill-rule="evenodd" points="11 1.576 6.583 6 11 10.424 10.424 11 6 6.583 1.576 11 1 10.424 5.417 6 1 1.576 1.576 1 6 5.417 10.424 1"></polygon></svg></div>';
                    buttons.className = 'winButtons_c38106 winButtonsWithDivider_c38106';
                    buttons.style.position = 'fixed';
                    buttons.style.top = '0px';
                    buttons.style.right = '0px';
                    buttons.style.zIndex = '99999';
                    // close button
                    buttons.querySelector('.winButtonClose_c38106').onclick = () => {
                        ipc.indicate('title-button', 'close');
                    };
                    buttons.querySelectorAll('.winButtonMinMax_c38106')[1].onclick = () => {
                        ipc.indicate('title-button', 'maximize');
                    };
                    buttons.querySelector('.winButtonMinMax_c38106').onclick = () => {
                        ipc.indicate('title-button', 'minimize');
                    };
                    document.body.appendChild(buttons);
                }, 10);
            }})()`);
        };
        // title-related stuff
        let ot;
        setInterval(() => {
            if(document.title !== ot) {
                ot = appWin.document.title;
                ipc.indicate('window-title', { title: appWin.document.title });
            }
        }, 100);
        // Make it feel more native
        fetch('/native.css').then(reqd => reqd.text()).then(css => {
            const style = appWin.document.createElement('style');
            style.innerHTML = css;
            setTimeout(() => {
                appWin.document.head.appendChild(style);
            }, 300);
        });
    });
});