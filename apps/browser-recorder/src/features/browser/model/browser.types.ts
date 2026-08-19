import type {
  BrowserPageState,
  CaptchaStatus,
  DatePickerState,
  PopupState,
  SelectPickerState,
} from "@/shared/contracts/protocol";

export type {
  BrowserPageState,
  DatePickerState,
  PopupState,
  SelectPickerState,
} from "@/shared/contracts/protocol";

export interface BrowserNavigationState {
  enabled: boolean;
  pending: boolean;
  error: string | null;
}

export interface BrowserViewModel {
  page: BrowserPageState | null;
  liveViewUrl: string | null;
  popup: PopupState | null;
  datePicker: DatePickerState | null;
  selectPicker: SelectPickerState | null;
  captchaStatus: CaptchaStatus | null;
  nativeSelects: boolean;
  nativeSelectsEnabled: boolean;
  preparing: boolean;
  reconnecting: boolean;
  restoreFocusAfterCaptcha: boolean;
  navigation: BrowserNavigationState;
}

export interface BrowserActions {
  goBack: () => void;
  goForward: () => void;
  navigate: (url: string) => void;
  reload: () => void;
  switchPopup: (pageId: string) => void;
  selectDate: (requestId: string, value: string) => void;
  dismissDatePicker: (requestId: string) => void;
  selectPickerOption: (requestId: string, value: string) => void;
  dismissSelectPicker: (requestId: string) => void;
  setNativeSelects: (enabled: boolean) => void;
  continueAfterCaptcha: () => void;
}
