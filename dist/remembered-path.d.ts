/** Where the answer to the path prompt is kept, so it is asked once and not every start. */
export declare function configFilePath(): string;
export declare function readRememberedPath(): string | undefined;
export declare function rememberPath(qeaPath: string): void;
export declare function forgetPath(): void;
