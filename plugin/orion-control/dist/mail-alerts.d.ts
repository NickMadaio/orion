export type MailAlertItem = {
    messageId?: string;
    who: string;
    fromAddress: string;
    domain: string;
    topic?: string | null;
    person?: boolean;
};
export type MailAlert = {
    id: string;
    at: string;
    text: string;
    items: MailAlertItem[];
};
export declare const MAIL_ALERT_BIND_MS: number;
export declare const mailAlertsFile: (stateDir: string, realNow?: () => number) => string;
export declare function readMailAlerts(path: string, max?: number): MailAlert[];
/** The alert his reply may be about, or undefined. */
export declare function currentMailAlert(alerts: MailAlert[], now: Date, seen: {
    label?: string;
    lastPush?: {
        text: string;
        at: string;
    } | null;
}): MailAlert | undefined;
