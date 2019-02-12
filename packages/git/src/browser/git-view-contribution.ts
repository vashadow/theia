/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
import {inject, injectable} from 'inversify';
import URI from '@theia/core/lib/common/uri';
import {
    Command,
    CommandContribution,
    CommandRegistry,
    DisposableCollection,
    Emitter,
    MenuContribution,
    MenuModelRegistry
} from '@theia/core';
import {
    AbstractViewContribution,
    DiffUris,
    FrontendApplication,
    FrontendApplicationContribution,
    StatusBar,
    StatusBarEntry,
    Widget
} from '@theia/core/lib/browser';
import {TabBarToolbarContribution, TabBarToolbarRegistry} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import {
    EDITOR_CONTEXT_MENU,
    EditorContextMenu,
    EditorManager,
    EditorOpenerOptions,
    EditorWidget
} from '@theia/editor/lib/browser';
import {Git, GitFileChange, GitFileStatus, Repository} from '../common';
import {GitWidget} from './git-widget';
import {GitRepositoryTracker} from './git-repository-tracker';
import {GitAction, GitQuickOpenService} from './git-quick-open-service';
import {GitSyncService} from './git-sync-service';
import {WorkspaceService} from '@theia/workspace/lib/browser';
import {GitPrompt} from '../common/git-prompt';
import {ScmCommand,  ScmRepository, ScmService} from '@theia/scm/lib/browser';
import {GitRepositoryProvider} from './git-repository-provider';
import {GitCommitMessageValidator} from '../browser/git-commit-message-validator';
import {GitErrorHandler} from '../browser/git-error-handler';

export const GIT_WIDGET_FACTORY_ID = 'git';

export const EDITOR_CONTEXT_MENU_GIT = [...EDITOR_CONTEXT_MENU, '3_git'];

export namespace GIT_COMMANDS {
    export const CLONE = {
        id: 'git.clone',
        label: 'Git: Clone...'
    };
    export const FETCH = {
        id: 'git.fetch',
        label: 'Git: Fetch...'
    };
    export const PULL_DEFAULT = {
        id: 'git.pull.default',
        label: 'Git: Pull'
    };
    export const PULL = {
        id: 'git.pull',
        label: 'Git: Pull from...'
    };
    export const PUSH_DEFAULT = {
        id: 'git.push.default',
        label: 'Git: Push'
    };
    export const PUSH = {
        id: 'git.push',
        label: 'Git: Push to...'
    };
    export const MERGE = {
        id: 'git.merge',
        label: 'Git: Merge...'
    };
    export const CHECKOUT = {
        id: 'git.checkout',
        label: 'Git: Checkout'
    };
    export const COMMIT_AMEND = {
        id: 'git.commit.amend'
    };
    export const COMMIT_SIGN_OFF = {
        id: 'git.commit.signOff'
    };
    export const CHANGE_REPOSITORY = {
        id: 'git.change.repository',
        label: 'Git: Change Repository...'
    };
    export const OPEN_FILE: Command = {
        id: 'git.open.file',
        category: 'Git',
        label: 'Open File'
    };
    export const OPEN_CHANGES: Command = {
        id: 'git.open.changes',
        category: 'Git',
        label: 'Open Changes'
    };
    export const SYNC = {
        id: 'git.sync',
        label: 'Git: Sync'
    };
    export const PUBLISH = {
        id: 'git.publish',
        label: 'Git: Publish Branch'
    };
    export const STAGE_ALL = {
        id: 'git.stage.all'
    };
    export const UNSTAGE_ALL = {
        id: 'git.unstage.all'
    };
    export const DISCARD_ALL = {
        id: 'git.discard.all'
    };
}

@injectable()
export class GitViewContribution extends AbstractViewContribution<GitWidget>
    implements FrontendApplicationContribution, CommandContribution, MenuContribution, TabBarToolbarContribution {

    static GIT_SELECTED_REPOSITORY = 'git-selected-repository';
    static GIT_REPOSITORY_STATUS = 'git-repository-status';
    static GIT_SYNC_STATUS = 'git-sync-status';

    private static ID_HANDLE = 0;

    protected toDispose = new DisposableCollection();

    private readonly onDidChangeCommandEmitterMap: Map<string, Emitter<ScmCommand[]>> = new Map();
    private readonly onDidChangeRepositoryEmitterMap: Map<string, Emitter<void>> = new Map();
    private dirtyRepositories: Repository[] = [];

    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(EditorManager) protected readonly editorManager: EditorManager;
    @inject(GitQuickOpenService) protected readonly quickOpenService: GitQuickOpenService;
    @inject(GitRepositoryTracker) protected readonly repositoryTracker: GitRepositoryTracker;
    @inject(GitSyncService) protected readonly syncService: GitSyncService;
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService;
    @inject(GitPrompt) protected readonly prompt: GitPrompt;
    @inject(ScmService) protected readonly scmService: ScmService;
    @inject(GitRepositoryProvider) protected readonly repositoryProvider: GitRepositoryProvider;
    @inject(GitCommitMessageValidator) protected readonly commitMessageValidator: GitCommitMessageValidator;
    @inject(CommandRegistry) protected readonly commandRegistry: CommandRegistry;
    @inject(Git) protected readonly git: Git;
    @inject(GitErrorHandler)protected readonly gitErrorHandler: GitErrorHandler;

    constructor() {
        super({
            widgetId: GIT_WIDGET_FACTORY_ID,
            widgetName: 'Git',
            defaultWidgetOptions: {
                area: 'left',
                rank: 200
            },
            toggleCommandId: 'gitView:toggle',
            toggleKeybinding: 'ctrlcmd+shift+g'
        });
    }

    async initializeLayout(app: FrontendApplication): Promise<void> {
        await this.openView();
    }

    onStart(): void {
        this.repositoryProvider.allRepositories.forEach(repository => this.registerScmProvider(repository));
        this.dirtyRepositories = this.repositoryProvider.allRepositories;
        this.repositoryTracker.onDidChangeRepository(repository => {
            if (repository) {
                if (this.hasMultipleRepositories()) {
                    const path = new URI(repository.localUri).path;
                    this.scmService.selectedRepositories.forEach(scmRepo => scmRepo.setSelected(false));
                    const scmRepository = this.scmService.repositories.find(scmRepo => scmRepo.provider.rootUri === repository.localUri);
                    if (scmRepository) {
                        scmRepository.setSelected(true);
                    }
                    const onDidChangeCommandEmitter = this.onDidChangeCommandEmitterMap.get(repository.localUri);
                    if (onDidChangeCommandEmitter) {
                        onDidChangeCommandEmitter.fire([{
                            id: GIT_COMMANDS.CHANGE_REPOSITORY.id,
                            text: `$(database) ${path.base}`,
                            command: GIT_COMMANDS.CHANGE_REPOSITORY.id,
                            tooltip: path.toString()
                        }]);
                    }
                } else {
                    this.statusBar.removeElement(GitViewContribution.GIT_SELECTED_REPOSITORY);
                }
            } else {
                this.statusBar.removeElement(GitViewContribution.GIT_SELECTED_REPOSITORY);
                this.statusBar.removeElement(GitViewContribution.GIT_REPOSITORY_STATUS);
                this.statusBar.removeElement(GitViewContribution.GIT_SYNC_STATUS);
            }
        });
        this.repositoryTracker.onGitEvent(event => {
            this.checkNewOrRemovedRepositories();
            const { status } = event;
            const branch = status.branch ? status.branch : status.currentHead ? status.currentHead.substring(0, 8) : 'NO-HEAD';
            let dirty = '';
            if (status.changes.length > 0) {
                const conflicts = this.hasConflicts(status.changes);
                const staged = this.allStaged(status.changes);
                if (conflicts || staged) {
                    if (conflicts) {
                        dirty = '!';
                    } else if (staged) {
                        dirty = '+';
                    }
                } else {
                    dirty = '*';
                }
            }
            const onDidChangeCommandEmitter = this.onDidChangeCommandEmitterMap.get(event.source.localUri);
            if (onDidChangeCommandEmitter) {
                onDidChangeCommandEmitter.fire([{
                    id: GIT_COMMANDS.CHECKOUT.id,
                    text: `$(code-fork) ${branch}${dirty}`,
                    command: GIT_COMMANDS.CHECKOUT.id
                }]);
            }
            // const scmRepository = this.scmService.repositories.find(repo => repo.provider.rootUri === event.source.localUri);
            // if (scmRepository) {
            //     scmRepository.provider.groups = [{resources: [], provider: scmRepository.provider, label: 'Changes'}]
            // }
            const onDidChangeRepositoryEmitter = this.onDidChangeRepositoryEmitterMap.get(event.source.localUri);
            if (onDidChangeRepositoryEmitter) {
                onDidChangeRepositoryEmitter.fire(undefined);
            }
            this.updateSyncStatusBarEntry(event.source.localUri);
        });
        this.syncService.onDidChange(() => this.updateSyncStatusBarEntry(
            this.repositoryProvider.selectedRepository
            ? this.repositoryProvider.selectedRepository.localUri
            : undefined)
        );
    }

    /** Detect and handle added or removed repositories. */
    private checkNewOrRemovedRepositories() {
        const added =
            this.repositoryProvider
                .allRepositories
                .find(repo => this.dirtyRepositories.every(dirtyRepo => dirtyRepo.localUri !== repo.localUri));
        if (added) {
            this.registerScmProvider(added);
        }
        const removed =
            this.dirtyRepositories
                .find(dirtyRepo => this.repositoryProvider.allRepositories.every(repo => repo.localUri !== dirtyRepo.localUri));
        if (removed) {
            const removedScmRepo = this.scmService.repositories.find(scmRepo => scmRepo.provider.rootUri === removed.localUri);
            if (removedScmRepo) {
                removedScmRepo.dispose();
            }
        }
        this.dirtyRepositories = this.repositoryProvider.allRepositories;
    }

    private registerScmProvider(repository: Repository): ScmRepository {
        const uri = repository.localUri;
        const disposableCollection = new DisposableCollection();
        const onDidChangeStatusBarCommandsEmitter = new Emitter<ScmCommand[]>();
        const onDidChangeResourcesEmitter = new Emitter<void>();
        const onDidChangeRepositoryEmitter = new Emitter<void>();
        this.onDidChangeCommandEmitterMap.set(uri, onDidChangeStatusBarCommandsEmitter);
        this.onDidChangeRepositoryEmitterMap.set(uri, onDidChangeRepositoryEmitter);
        disposableCollection.push(onDidChangeRepositoryEmitter);
        disposableCollection.push(onDidChangeResourcesEmitter);
        const dispose = () => {
            disposableCollection.dispose();
            this.onDidChangeCommandEmitterMap.delete(uri);
            this.onDidChangeRepositoryEmitterMap.delete(uri);
        };
        const repo =  this.scmService.registerScmProvider({
            label: 'Git',
            id: `git_provider_${ GitViewContribution.ID_HANDLE ++ }`,
            contextValue: 'git',
            onDidChange: onDidChangeRepositoryEmitter.event,
            onDidChangeStatusBarCommands: onDidChangeStatusBarCommandsEmitter.event,
            onDidChangeResources: onDidChangeRepositoryEmitter.event,
            rootUri: uri,
            acceptInputCommand: {
                id: 'git-command-id',
                tooltip: 'tooltip',
                text: 'text',
                command: 'command'
            },
            groups: [],
            async getOriginalResource() {
                return undefined;
            },
            dispose(): void {
                dispose();
            }
        });
        const commit = (scmRepository: ScmRepository, message: string) => {
            const localUri = scmRepository.provider.rootUri;
            if (localUri) {
                this.doCommit({ localUri }, message);
            }
        };
        this.commandRegistry.registerCommand({ id: 'git-command-id' },
            {
            // tslint:disable-next-line:no-any
            execute(...args): any {
                if (args.length > 1) {
                    commit(args[0], args[1]);
                }
            }
        });
        repo.input.placeholder = 'Commit Message';
        repo.input.validateInput = async input => {
            const validate = await this.commitMessageValidator.validate(input);
            if (validate) {
                const { message, status } = validate;
                return { message, type: status };
            }
        };
        return repo;
    }

    async doCommit(repository: Repository, message: string, options?: 'amend' | 'sign-off') {
        try {
            // We can make sure, repository exists, otherwise we would not have this button.
            const signOff = options === 'sign-off';
            const amend = options === 'amend';
            await this.git.commit(repository, message, { signOff, amend });
        } catch (error) {
            this.gitErrorHandler.handleError(error);
        }
    }

    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        [GIT_COMMANDS.FETCH, GIT_COMMANDS.PULL_DEFAULT, GIT_COMMANDS.PULL, GIT_COMMANDS.PUSH_DEFAULT, GIT_COMMANDS.PUSH, GIT_COMMANDS.MERGE].forEach(command =>
            menus.registerMenuAction(GitWidget.ContextMenu.OTHER_GROUP, {
                commandId: command.id,
                label: command.label.slice('Git: '.length)
            })
        );
        menus.registerMenuAction(GitWidget.ContextMenu.COMMIT_GROUP, {
            commandId: GIT_COMMANDS.COMMIT_AMEND.id,
            label: 'Commit (Amend)'
        });
        menus.registerMenuAction(GitWidget.ContextMenu.COMMIT_GROUP, {
            commandId: GIT_COMMANDS.COMMIT_SIGN_OFF.id,
            label: 'Commit (Signed Off)'
        });
        menus.registerMenuAction(GitWidget.ContextMenu.BATCH, {
            commandId: GIT_COMMANDS.STAGE_ALL.id,
            label: 'Stage All Changes'
        });
        menus.registerMenuAction(GitWidget.ContextMenu.BATCH, {
            commandId: GIT_COMMANDS.UNSTAGE_ALL.id,
            label: 'Unstage All Changes'
        });
        menus.registerMenuAction(GitWidget.ContextMenu.BATCH, {
            commandId: GIT_COMMANDS.DISCARD_ALL.id,
            label: 'Discard All Changes'
        });
        menus.registerMenuAction(EditorContextMenu.NAVIGATION, {
            commandId: GIT_COMMANDS.OPEN_FILE.id
        });
        menus.registerMenuAction(EditorContextMenu.NAVIGATION, {
            commandId: GIT_COMMANDS.OPEN_CHANGES.id
        });
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(GIT_COMMANDS.FETCH, {
            execute: () => this.quickOpenService.fetch(),
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.PULL_DEFAULT, {
            execute: () => this.quickOpenService.performDefaultGitAction(GitAction.PULL),
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.PULL, {
            execute: () => this.quickOpenService.pull(),
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.PUSH_DEFAULT, {
            execute: () => this.quickOpenService.performDefaultGitAction(GitAction.PUSH),
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.PUSH, {
            execute: () => this.quickOpenService.push(),
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.MERGE, {
            execute: () => this.quickOpenService.merge(),
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.CHECKOUT, {
            execute: () => this.quickOpenService.checkout(),
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.COMMIT_SIGN_OFF, {
            execute: () => this.tryGetWidget()!.doCommit(this.repositoryTracker.selectedRepository, 'sign-off'),
            isEnabled: () => !!this.tryGetWidget() && !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.COMMIT_AMEND, {
            execute: async () => {
                const widget = this.tryGetWidget();
                const { selectedRepository } = this.repositoryTracker;
                if (!!widget && !!selectedRepository) {
                    try {
                        const message = await this.quickOpenService.commitMessageForAmend();
                        widget.doCommit(selectedRepository, 'amend', message);
                    } catch (e) {
                        if (!(e instanceof Error) || e.message !== 'User abort.') {
                            throw e;
                        }
                    }
                }
            },
            isEnabled: () => !!this.tryGetWidget() && !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.STAGE_ALL, {
            execute: async () => {
                const widget = this.tryGetWidget();
                if (!!widget) {
                    widget.stageAll();
                }
            },
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.UNSTAGE_ALL, {
            execute: async () => {
                const widget = this.tryGetWidget();
                if (!!widget) {
                    widget.unstageAll();
                }
            },
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.DISCARD_ALL, {
            execute: async () => {
                const widget = this.tryGetWidget();
                if (!!widget) {
                    widget.discardAll();
                }
            },
            isEnabled: () => !!this.repositoryTracker.selectedRepository
        });
        registry.registerCommand(GIT_COMMANDS.CHANGE_REPOSITORY, {
            execute: () => this.quickOpenService.changeRepository(),
            isEnabled: () => this.hasMultipleRepositories()
        });
        registry.registerCommand(GIT_COMMANDS.OPEN_FILE, {
            execute: widget => this.openFile(widget),
            isEnabled: widget => !!this.getOpenFileOptions(widget),
            isVisible: widget => !!this.getOpenFileOptions(widget)
        });
        registry.registerCommand(GIT_COMMANDS.OPEN_CHANGES, {
            execute: widget => this.openChanges(widget),
            isEnabled: widget => !!this.getOpenChangesOptions(widget),
            isVisible: widget => !!this.getOpenChangesOptions(widget)
        });
        registry.registerCommand(GIT_COMMANDS.SYNC, {
            execute: () => this.syncService.sync(),
            isEnabled: () => this.syncService.canSync(),
            isVisible: () => this.syncService.canSync()
        });
        registry.registerCommand(GIT_COMMANDS.PUBLISH, {
            execute: () => this.syncService.publish(),
            isEnabled: () => this.syncService.canPublish(),
            isVisible: () => this.syncService.canPublish()
        });
        registry.registerCommand(GIT_COMMANDS.CLONE, {
            isEnabled: () => this.workspaceService.opened,
            // tslint:disable-next-line:no-any
            execute: (...args: any[]) => {
                let url: string | undefined = undefined;
                let folder: string | undefined = undefined;
                let branch: string | undefined = undefined;
                if (args) {
                    [url, folder, branch] = args;
                }
                return this.quickOpenService.clone(url, folder, branch);
            }
        });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        registry.registerItem({
            id: GIT_COMMANDS.OPEN_FILE.id,
            command: GIT_COMMANDS.OPEN_FILE.id,
            text: '$(file-o)',
            tooltip: GIT_COMMANDS.OPEN_FILE.label
        });
        registry.registerItem({
            id: GIT_COMMANDS.OPEN_CHANGES.id,
            command: GIT_COMMANDS.OPEN_CHANGES.id,
            text: '$(files-o)',
            tooltip: GIT_COMMANDS.OPEN_CHANGES.label
        });
    }

    protected hasConflicts(changes: GitFileChange[]): boolean {
        return changes.some(c => c.status === GitFileStatus.Conflicted);
    }

    protected allStaged(changes: GitFileChange[]): boolean {
        return !changes.some(c => !c.staged);
    }

    protected async openFile(widget?: Widget): Promise<EditorWidget | undefined> {
        const options = this.getOpenFileOptions(widget);
        return options && this.editorManager.open(options.uri, options.options);
    }

    protected getOpenFileOptions(widget?: Widget): GitOpenFileOptions | undefined {
        const ref = widget ? widget : this.editorManager.currentEditor;
        if (ref instanceof EditorWidget && DiffUris.isDiffUri(ref.editor.uri)) {
            const [, right] = DiffUris.decode(ref.editor.uri);
            const uri = right.withScheme('file');
            const selection = ref.editor.selection;
            return { uri, options: { selection, widgetOptions: { ref } } };
        }
        return undefined;
    }

    async openChanges(widget?: Widget): Promise<EditorWidget | undefined> {
        const options = this.getOpenChangesOptions(widget);
        if (options) {
            const view = await this.widget;
            return view.openChange(options.change, options.options);
        }
        return undefined;
    }

    protected getOpenChangesOptions(widget?: Widget): GitOpenChangesOptions | undefined {
        const view = this.tryGetWidget();
        if (!view) {
            return undefined;
        }
        const ref = widget ? widget : this.editorManager.currentEditor;
        if (ref instanceof EditorWidget && !DiffUris.isDiffUri(ref.editor.uri)) {
            const uri = ref.editor.uri;
            const change = view.findChange(uri);
            if (change && view.getUriToOpen(change).toString() !== uri.toString()) {
                const selection = ref.editor.selection;
                return { change, options: { selection, widgetOptions: { ref } } };
            }
        }
        return undefined;
    }

    protected hasMultipleRepositories(): boolean {
        return this.repositoryTracker.allRepositories.length > 1;
    }

    protected updateSyncStatusBarEntry(repositoryUri: string | undefined): void {
        const entry = this.getStatusBarEntry();
        if (entry && repositoryUri) {
            const onDidChangeCommandEmitter = this.onDidChangeCommandEmitterMap.get(repositoryUri);
            if (onDidChangeCommandEmitter) {
                onDidChangeCommandEmitter.fire([{
                    id: 'vcs-sync-status',
                    text: entry.text,
                    tooltip: entry.tooltip,
                    command: entry.command,
                }]);
            }
        } else {
            this.statusBar.removeElement(GitViewContribution.GIT_SYNC_STATUS);
        }
    }
    protected getStatusBarEntry(): (Pick<StatusBarEntry, 'text'> & Partial<StatusBarEntry>) | undefined {
        const status = this.repositoryTracker.selectedRepositoryStatus;
        if (!status || !status.branch) {
            return undefined;
        }
        if (this.syncService.isSyncing()) {
            return {
                text: '$(refresh~spin)',
                tooltip: 'Synchronizing Changes...'
            };
        }
        const { upstreamBranch, aheadBehind } = status;
        if (upstreamBranch) {
            return {
                text: '$(refresh)' + (aheadBehind ? ` ${aheadBehind.behind} $(arrow-down) ${aheadBehind.ahead} $(arrow-up)` : ''),
                command: GIT_COMMANDS.SYNC.id,
                tooltip: 'Synchronize Changes'
            };
        }
        return {
            text: '$(cloud-upload)',
            command: GIT_COMMANDS.PUBLISH.id,
            tooltip: 'Publish Changes'
        };
    }
}
export interface GitOpenFileOptions {
    readonly uri: URI
    readonly options?: EditorOpenerOptions
}
export interface GitOpenChangesOptions {
    readonly change: GitFileChange
    readonly options?: EditorOpenerOptions
}
