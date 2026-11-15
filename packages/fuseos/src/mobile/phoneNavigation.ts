export interface PhoneNavigation {
  read(): string;
  push(screen: string): void;
  back(): void;
  subscribe(listener: () => void): () => void;
}

/** Query routes work on static hosting and retain mute/recording flags. */
export function browserPhoneNavigation(browser: Window): PhoneNavigation {
  const read = () =>
    new URL(browser.location.href).searchParams.get("open")?.split(",")[0] ||
    "home";
  return {
    read,
    push(screen) {
      if (read() === screen) return;
      const url = new URL(browser.location.href);
      if (screen === "home") url.searchParams.delete("open");
      else url.searchParams.set("open", screen);
      browser.history.pushState({ phone: true }, "", url);
    },
    back() {
      if (browser.history.state?.phone) browser.history.back();
      else {
        const url = new URL(browser.location.href);
        url.searchParams.delete("open");
        browser.history.replaceState(null, "", url);
        browser.dispatchEvent(new PopStateEvent("popstate"));
      }
    },
    subscribe(listener) {
      browser.addEventListener("popstate", listener);
      return () => browser.removeEventListener("popstate", listener);
    },
  };
}

export interface WelcomePreference {
  seen(): boolean;
  dismiss(): void;
}

export function browserWelcomePreference(browser: Window): WelcomePreference {
  return {
    seen() {
      try {
        return browser.localStorage.getItem("fuse.phone.welcome.v1") === "seen";
      } catch {
        return false;
      }
    },
    dismiss() {
      try {
        browser.localStorage.setItem("fuse.phone.welcome.v1", "seen");
      } catch {
        /* Private browsing can deny storage; dismissal still works in this visit. */
      }
    },
  };
}
