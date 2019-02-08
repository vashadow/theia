/********************************************************************************
 * Copyright (C) 2019 Red Hat, Inc. and others.
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
import {
    InputValidator,
    ScmInput,
    ScmProvider,
    ScmRepository,
    ScmService
} from '../common/scm';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import { injectable } from 'inversify';

@injectable()
export class ScmServiceImpl implements ScmService {
    private providerIds = new Set<string>();
    private _repositories: ScmRepository[] = [];
    private _selectedRepositories: ScmRepository[] = [];

    private onDidChangeSelectedRepositoriesEmitter = new Emitter<ScmRepository[]>();
    private onDidAddProviderEmitter = new Emitter<ScmRepository>();
    private onDidRemoveProviderEmitter = new Emitter<ScmRepository>();

    readonly onDidChangeSelectedRepositories: Event<ScmRepository[]> = this.onDidChangeSelectedRepositoriesEmitter.event;

    get repositories(): ScmRepository[] {
        return [...this._repositories];
    }

    get selectedRepositories(): ScmRepository[] {
        return [...this._selectedRepositories];
    }

    get onDidAddRepository(): Event<ScmRepository> {
        return this.onDidAddProviderEmitter.event;
    }

    get onDidRemoveRepository(): Event<ScmRepository> { return this.onDidRemoveProviderEmitter.event; }

    registerScmProvider(provider: ScmProvider): ScmRepository {

        if (this.providerIds.has(provider.id)) {
            throw new Error(`SCM Provider ${provider.id} already exists.`);
        }

        this.providerIds.add(provider.id);

        function toDisposable(fn: () => void): Disposable {
            return { dispose() { fn(); } };
        }
        const disposable: Disposable = toDisposable(() => {
            const index = this._repositories.indexOf(repository);
            if (index < 0) {
                return;
            }
            selectedDisposable.dispose();
            this.providerIds.delete(provider.id);
            this._repositories.splice(index, 1);
            this.onDidRemoveProviderEmitter.fire(repository);
            this.onDidChangeSelection();
        });

        const repository = new SCMRepositoryImpl(provider, disposable);
        const selectedDisposable = repository.onDidChangeSelection(this.onDidChangeSelection, this);

        this._repositories.push(repository);
        this.onDidAddProviderEmitter.fire(repository);

        // automatically select the first repository
        if (this._repositories.length === 1) {
            repository.setSelected(true);
        }

        return repository;
    }

    private onDidChangeSelection(): void {
        this._selectedRepositories = this._repositories.filter(r => r.selected);
        this.onDidChangeSelectedRepositoriesEmitter.fire(this.selectedRepositories);
    }
}

class SCMRepositoryImpl implements ScmRepository {

    private _onDidFocus = new Emitter<void>();
    readonly onDidFocus: Event<void> = this._onDidFocus.event;

    private _selected = false;
    get selected(): boolean {
        return this._selected;
    }

    private _onDidChangeSelection = new Emitter<boolean>();
    readonly onDidChangeSelection: Event<boolean> = this._onDidChangeSelection.event;

    readonly input: ScmInput = new SCMInputImpl();

    constructor(
        public readonly provider: ScmProvider,
        private disposable: Disposable
    ) { }

    focus(): void {
        this._onDidFocus.fire(undefined);
    }

    setSelected(selected: boolean): void {
        this._selected = selected;
        this._onDidChangeSelection.fire(selected);
    }

    dispose(): void {
        this.disposable.dispose();
        this.provider.dispose();
    }
}

class SCMInputImpl implements ScmInput {

    private _value = '';

    get value(): string {
        return this._value;
    }

    set value(value: string) {
        this._value = value;
        this._onDidChange.fire(value);
    }

    private _onDidChange = new Emitter<string>();
    get onDidChange(): Event<string> { return this._onDidChange.event; }

    private _placeholder = '';

    get placeholder(): string {
        return this._placeholder;
    }

    set placeholder(placeholder: string) {
        this._placeholder = placeholder;
        this._onDidChangePlaceholder.fire(placeholder);
    }

    private _onDidChangePlaceholder = new Emitter<string>();
    get onDidChangePlaceholder(): Event<string> { return this._onDidChangePlaceholder.event; }

    private _visible = true;

    get visible(): boolean {
        return this._visible;
    }

    set visible(visible: boolean) {
        this._visible = visible;
        this._onDidChangeVisibility.fire(visible);
    }

    private _onDidChangeVisibility = new Emitter<boolean>();
    get onDidChangeVisibility(): Event<boolean> { return this._onDidChangeVisibility.event; }

    private _validateInput: InputValidator = () => Promise.resolve(undefined);

    get validateInput(): InputValidator {
        return this._validateInput;
    }

    set validateInput(validateInput: InputValidator) {
        this._validateInput = validateInput;
        this._onDidChangeValidateInput.fire(undefined);
    }

    private _onDidChangeValidateInput = new Emitter<void>();
    get onDidChangeValidateInput(): Event<void> { return this._onDidChangeValidateInput.event; }
}
