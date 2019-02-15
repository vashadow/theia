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
import { injectable, inject, postConstruct } from 'inversify';
import {ReactWidget} from '@theia/core/lib/browser';
import * as React from 'react';
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message';
import {InputValidator, ScmInput, ScmRepository, ScmResourceGroup, ScmService} from './scm-service';
import {CommandRegistry} from '@theia/core';
import {ScmResource} from '../browser';
import {EditorManager} from '@theia/editor/lib/browser';

@injectable()
export class ScmWidget extends ReactWidget {
    private static MESSAGE_BOX_MIN_HEIGHT = 25;

    protected message: string = '';
    protected messageBoxHeight: number = ScmWidget.MESSAGE_BOX_MIN_HEIGHT;
    protected inputCommandMessageValidator: InputValidator | undefined;
    protected inputCommandMessageValidationResult: InputValidator.Result | undefined;
    protected scrollContainer: string;
    protected listContainer: ScmResourceGroupsContainer | undefined;

    constructor(@inject(ScmService) private readonly scmService: ScmService,
                @inject(CommandRegistry) private readonly commandRegistry: CommandRegistry,
                @inject(EditorManager) protected readonly editorManager: EditorManager) {
        super();
        this.id = 'theia-scmContainer';
        this.title.label = 'Scm';
        this.title.caption = 'Scm';
        this.title.iconClass = 'fa extensions-tab-icon';
        this.addClass('theia-scm');
        this.scrollContainer = ScmWidget.Styles.GROUPS_CONTAINER;

        this.update();
    }
    @postConstruct()
    protected init() {
        this.scmService.repositories.forEach(repo => repo.provider.onDidChangeResources(() => {
            this.update();
        }));
        this.scmService.onDidChangeSelectedRepositories(repository => {
            this.update();
        });
    }
    protected render(): React.ReactNode {
        const repository = this.scmService.selectedRepositories[0];
        if (!repository) {
            return <AlertMessage
                type='WARNING'
                header='Source control is not available at this time'
            />;
        }
        const input = repository.input;
        if (input) {
            this.inputCommandMessageValidator = input.validateInput;
            return <div className={ScmWidget.Styles.MAIN_CONTAINER}>
                <div className='headerContainer'>
                    {this.renderInputCommand(input)}
                    {this.renderCommandBar(repository)}
                </div>
                <ScmResourceGroupsContainer
                    id={this.scrollContainer}
                    repository={repository}
                />
            </div>;
        }
    }

    protected renderInputCommand(input: ScmInput): React.ReactNode {
        const validationStatus = this.inputCommandMessageValidationResult ? this.inputCommandMessageValidationResult.type : 'idle';
        const validationMessage = this.inputCommandMessageValidationResult ? this.inputCommandMessageValidationResult.message : '';
        return <div className={ScmWidget.Styles.INPUT_MESSAGE_CONTAINER}>
            <textarea
                className={`${ScmWidget.Styles.INPUT_MESSAGE} theia-scm-input-message-${validationStatus}`}
                style={{
                    height: this.messageBoxHeight,
                    overflow: this.messageBoxHeight > ScmWidget.MESSAGE_BOX_MIN_HEIGHT ? 'auto' : 'hidden'
                }}
                autoFocus={true}
                onInput={this.onInputMessageChange.bind(this)}
                placeholder={`${input.placeholder}`}
                id={ScmWidget.Styles.INPUT_MESSAGE}
                defaultValue={`${input.value}`}
                tabIndex={1}>
            </textarea>
            <div
                className={
                    `${ScmWidget.Styles.VALIDATION_MESSAGE} ${ScmWidget.Styles.NO_SELECT}
                    theia-git-validation-message-${validationStatus} theia-scm-input-message-${validationStatus}`
                }
                style={
                    {
                        display: !!this.inputCommandMessageValidationResult ? 'block' : 'none'
                    }
                }>{validationMessage}</div>
        </div>;
    }

    protected onInputMessageChange(e: Event): void {
        const { target } = e;
        if (target instanceof HTMLTextAreaElement) {
            const {value} = target;
            this.message = value;
            this.resize(target);
            if (this.inputCommandMessageValidator) {
                this.inputCommandMessageValidator(value).then(result => {
                    if (!InputValidator.Result.equal(this.inputCommandMessageValidationResult, result)) {
                        this.inputCommandMessageValidationResult = result;
                        this.update();
                    }
                });
            }
        }
    }

    protected renderCommandBar(repository: ScmRepository | undefined): React.ReactNode {
        return <div id='commandBar' className='flexcontainer'>
            <div className='placeholder'/>
            {this.renderCommand(repository)}
        </div>;
    }

    private renderCommand(repository: ScmRepository | undefined): React.ReactNode {
        if (repository && repository.provider.acceptInputCommand) {
            const command = repository.provider.acceptInputCommand;
            return <div className='buttons'>
                <button className='theia-button'
                        onClick={() => {
                            this.executeInputCommand(command.id, repository);
                        }} title={`${command.tooltip}`}>
                    {`${repository.provider.acceptInputCommand.text}`}
                </button>
            </div>;
        }
    }

    private executeInputCommand(commandId: string, repository: ScmRepository): void {
        this.inputCommandMessageValidationResult = undefined;
        if (this.message.trim().length === 0) {
            this.inputCommandMessageValidationResult = {
                type: 'error',
                message: 'Please provide an input'
            };
        }
        if (this.inputCommandMessageValidationResult === undefined) {
            this.commandRegistry.executeCommand(commandId, repository, this.message);
            this.resetInputMessages();
            this.update();
        } else {
            const messageInput = document.getElementById(ScmWidget.Styles.INPUT_MESSAGE) as HTMLInputElement;
            if (messageInput) {
                this.update();
                messageInput.focus();
            }
        }
    }

    private resetInputMessages(): void {
        this.message = '';
        const messageInput = document.getElementById(ScmWidget.Styles.INPUT_MESSAGE) as HTMLTextAreaElement;
        messageInput.value = '';
        this.resize(messageInput);
    }

    protected resize(textArea: HTMLTextAreaElement): void {
        // tslint:disable-next-line:no-null-keyword
        const fontSize = Number.parseInt(window.getComputedStyle(textArea, undefined).getPropertyValue('font-size').split('px')[0] || '0', 10);
        const { value } = textArea;
        if (Number.isInteger(fontSize) && fontSize > 0) {
            const requiredHeight = fontSize * value.split(/\r?\n/).length;
            if (requiredHeight < textArea.scrollHeight) {
                textArea.style.height = `${requiredHeight}px`;
            }
        }
        if (textArea.clientHeight < textArea.scrollHeight) {
            textArea.style.height = `${textArea.scrollHeight}px`;
            if (textArea.clientHeight < textArea.scrollHeight) {
                textArea.style.height = `${(textArea.scrollHeight * 2 - textArea.clientHeight)}px`;
            }
        }
        const updatedHeight = textArea.style.height;
        if (updatedHeight) {
            this.messageBoxHeight = parseInt(updatedHeight, 10) || ScmWidget.MESSAGE_BOX_MIN_HEIGHT;
            if (this.messageBoxHeight > ScmWidget.MESSAGE_BOX_MIN_HEIGHT) {
                textArea.style.overflow = 'auto';
            } else {
                // Hide the scroll-bar if we shrink down the size.
                textArea.style.overflow = 'hidden';
            }
        }
    }
}

export namespace ScmWidget {

    export namespace Styles {
        export const MAIN_CONTAINER = 'theia-scm-main-container';
        export const GROUPS_CONTAINER = 'groups-outer-container';
        export const INPUT_MESSAGE_CONTAINER = 'theia-scm-input-message-container';
        export const INPUT_MESSAGE = 'theia-scm-input-message';
        export const VALIDATION_MESSAGE = 'theia-scm-input-validation-message';
        export const NO_SELECT = 'no-select';
    }
}

export namespace ScmResourceItem {
    export interface Props {
        name: string
        path: string
        icon: string,
        letter: string,
        color: string,
        open: () => Promise<void>
    }
}

class ScmResourceItem extends React.Component<ScmResourceItem.Props> {
    render() {
        const { name, path, icon, letter, color, open } = this.props;
        const style = {
            color
        };
        return <div className={`scmItem ${ScmWidget.Styles.NO_SELECT}`}>
            <div className='noWrapInfo' onDoubleClick={open}>
                <span className={icon + ' file-icon'}/>
                <span className='name'>{name}</span>
                <span className='path'>{path}</span>
            </div>
            <div className='itemButtonsContainer'>
                <div title={`${letter}`} className={'status'} style={style}>
                    {letter}
                </div>
            </div>
        </div>;
    }
}

export namespace ScmResourceGroupsContainer {
    export interface Props {
        id: string
        repository: ScmRepository
    }
}

class ScmResourceGroupsContainer extends React.Component<ScmResourceGroupsContainer.Props> {
    render() {
        return (
            <div className={ScmWidget.Styles.GROUPS_CONTAINER} id={this.props.id}>
                {this.props.repository.provider.groups ? this.props.repository.provider.groups.map(group => this.renderGroup(group)) : undefined}
            </div>
        );
    }
    private renderGroup(group: ScmResourceGroup): React.ReactNode {
        return <ScmResourceGroupContainer group={group}/>;
    }
}
namespace ScmResourceGroupContainer {
    export interface Props {
        group: ScmResourceGroup
    }
}

class ScmResourceGroupContainer extends React.Component<ScmResourceGroupContainer.Props> {
    render() {
        const group = this.props.group;
        return <div key={`${group.id}`}>
            <div className='theia-header git-theia-header' key={group.id}>
                {`${group.label}`}
                {this.renderChangeCount(group.resources.length)}
            </div>
            <div>{group.resources.map(resource => this.renderScmResourceItem(resource, group.provider.rootUri))}</div>
        </div>;
    }

    protected renderChangeCount(changes: number | undefined): React.ReactNode {
        if (changes) {
            return <div className='notification-count-container git-change-count'>
                <span className='notification-count'>{changes}</span>
            </div>;
        }
    }

    protected renderScmResourceItem(resource: ScmResource, repoUri: string | undefined): React.ReactNode {
        if (!repoUri) {
            return undefined;
        }
        const decorations = resource.decorations;
        const uri = resource.sourceUri.path.toString();
        const project = repoUri.substring(repoUri.lastIndexOf('/') + 1);
        const name = uri.substring(uri.lastIndexOf('/') + 1) + ' ';
        const path = uri.substring(uri.lastIndexOf(project) + project.length + 1, uri.lastIndexOf('/'));
        return <ScmResourceItem key={`${resource.sourceUri}`}
                                name={name}
                                path={path.length > 1 ? path : ''}
                                icon={(decorations && decorations.icon) ? decorations.icon : ''}
                                color={(decorations && decorations.color) ? decorations.color : ''}
                                letter={(decorations && decorations.letter) ? decorations.letter : ''}
                                open={resource.open}
        />;
    }
}
