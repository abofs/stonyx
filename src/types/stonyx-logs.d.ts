declare module '@stonyx/logs' {
  type ChalkColorFn = (text: string) => string;
  type ColorSetting = string | ChalkColorFn;

  interface LogOptions {
    logToFileByDefault: boolean;
    logTimestamp: boolean;
    path: string;
    prefix: string;
    suffix: string;
    filename: string;
    additionalLogs: Record<string, ColorSetting>;
    systemLogs: Record<string, ColorSetting>;
  }

  export default class Log {
    options: LogOptions;
    typeOptions: Record<string, Partial<LogOptions>>;
    [key: string]: unknown;

    constructor(options?: Partial<LogOptions>);
    defineType(type: string, setting: ColorSetting, options?: Partial<LogOptions> | null): void;
    log(content: string, type: string, logToFile: boolean, overwrite: boolean): Promise<void>;
    debug(content: unknown, logToFile?: boolean, overwrite?: boolean): Promise<void>;
    writeToFile(type: string, content: string, overwrite: boolean): Promise<void>;
    resolveFilename(template: string, type: string): string;
    chalk(): unknown;
  }
}
