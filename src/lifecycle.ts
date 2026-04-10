export interface StoynxModule {
  init?(): Promise<void>;
  startup?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export async function runStartupHooks(modules: StoynxModule[]): Promise<void> {
  for (const module of modules) {
    if (typeof module.startup === 'function') await module.startup();
  }
}

export async function runShutdownHooks(modules: StoynxModule[]): Promise<void> {
  for (const module of [...modules].reverse()) {
    if (typeof module.shutdown === 'function') {
      try {
        await module.shutdown();
      } catch (error) {
        console.error('Error during module shutdown:', error);
      }
    }
  }
}
