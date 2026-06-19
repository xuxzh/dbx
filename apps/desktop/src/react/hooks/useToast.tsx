import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ToastContextValue {
  message: string;
  visible: boolean;
  toast: (msg: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);

  const toast = useCallback((msg: string, duration = 2000) => {
    setMessage(msg);
    setVisible(true);
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => {
      setVisible(false);
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ message, visible, toast }}>
      {children}
    </ToastContext.Provider>
  );
}

let timer = 0;

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Return a no-op toast if not within provider (should not happen in正常使用)
    return {
      message: "",
      visible: false,
      toast: (msg: string, duration = 2000) => {
        console.warn("useToast called outside ToastProvider, message:", msg);
      },
    };
  }
  return context;
}
