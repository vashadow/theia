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

@injectable()
export class ScmWidget extends ReactWidget {
    private static MESSAGE_BOX_MIN_HEIGHT = 25;

    protected message: string = '';
    protected messageBoxHeight: number = ScmWidget.MESSAGE_BOX_MIN_HEIGHT;
    protected inputCommandMessageValidator: InputValidator | undefined;
    protected inputCommandMessageValidationResult: InputValidator.Result | undefined;
    protected scrollContainer: string;
    protected listContainer: ScmGroupContainer | undefined;

    constructor(@inject(ScmService) private readonly scmService: ScmService,
                @inject(CommandRegistry) private readonly commandRegistry: CommandRegistry) {
        super();
        this.id = 'theia-scmContainer';
        this.title.label = 'Scm';
        this.title.caption = 'Scm';
        this.title.iconClass = 'fa extensions-tab-icon';
        this.addClass('theia-scm');
        this.scrollContainer = ScmWidget.Styles.CHANGES_CONTAINER;
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
                <ScmGroupContainer
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
            <div className='buttons'>
                <a className='toolbar-button' title='Refresh' >
                    <i className='fa fa-refresh' />
                </a>
                {
                    repository ?
                        <React.Fragment>
                            <a className='toolbar-button' title='Add Signed-off-by' >
                                <i className='fa fa-pencil-square-o ' />
                            </a >
                            <a className='toolbar-button' title='More...' >
                                <i className='fa fa-ellipsis-h' />
                            </a >
                        </React.Fragment>
                        : ''
                }
            </div >
            <div className='placeholder'></div >
            {this.renderCommand(repository)}
        </div>;
    }

    private renderCommand(repository: ScmRepository | undefined): React.ReactNode {
        if (repository && repository.provider.acceptInputCommand) {
            const command = repository.provider.acceptInputCommand;
            return <div className='buttons'>
                <button className='theia-button' title='Commit all the staged changes'
                        onClick={() => {
                            this.executeInputCommand(command.id, repository);
                        }}
                >
                    {`${repository.provider.acceptInputCommand.text}`}
                </button >
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

    // export namespace ContextMenu {
    //     export const PATH: MenuPath = ['git-widget-context-menu'];
    //     export const OTHER_GROUP: MenuPath = [...PATH, '1_other'];
    //     export const COMMIT_GROUP: MenuPath = [...PATH, '2_commit'];
    //     export const BATCH: MenuPath = [...PATH, '3_batch'];
    // }

    export namespace Styles {
        export const MAIN_CONTAINER = 'theia-scm-main-container';
        export const CHANGES_CONTAINER = 'changesOuterContainer';
        export const INPUT_MESSAGE_CONTAINER = 'theia-scm-input-message-container';
        export const INPUT_MESSAGE = 'theia-scm-input-message';
        // export const MESSAGE_CONTAINER = 'theia-git-message';
        // export const WARNING_MESSAGE = 'theia-git-message-warning';
        export const VALIDATION_MESSAGE = 'theia-git-commit-validation-message';
        // export const LAST_COMMIT_CONTAINER = 'theia-git-last-commit-container';
        // export const LAST_COMMIT_DETAILS = 'theia-git-last-commit-details';
        // export const LAST_COMMIT_MESSAGE_AVATAR = 'theia-git-last-commit-message-avatar';
        // export const LAST_COMMIT_MESSAGE_SUMMARY = 'theia-git-last-commit-message-summary';
        // export const LAST_COMMIT_MESSAGE_TIME = 'theia-git-last-commit-message-time';
        //
        // export const FLEX_CENTER = 'flex-container-center';
        export const NO_SELECT = 'no-select';
    }
}

export namespace ScmItem {
    export interface Props {
        name: string
        path: string
        icon: string,
        letter: string,
        color: string
    }
}

class ScmItem extends React.Component<ScmItem.Props> {
    render() {
        const { name, path, icon, letter, color } = this.props;
        const style = {
            color
        };
        return <div className={`scmItem ${ScmWidget.Styles.NO_SELECT}`}>
            <div className='noWrapInfo'>
                <span className={icon + ' file-icon'}></span>
                <span className='name'>{name}</span>
                <span className='path'>{path}</span>
            </div>
            <div className='itemButtonsContainer'>
                {/*{this.renderGitItemButtons()}*/}
                <div title={`${letter}`}
                     className={'status'} style={style}>
                    {letter}
                </div>
            </div>
        </div>;
    }
}

export namespace ScmGroupContainer {
    export interface Props {
        id: string
        repository: ScmRepository
    }
}

class ScmGroupContainer extends React.Component<ScmGroupContainer.Props> {
    render() {
        return (
            <div
                className={ScmWidget.Styles.CHANGES_CONTAINER}
                id={this.props.id}>
                {this.props.repository.provider.groups ? this.props.repository.provider.groups.map(group => this.renderGroup(group)) : undefined}
            </div>
        );
    }
    private renderGroup(group: ScmResourceGroup): React.ReactNode {
        return <div key={`${group.id}`}>
            <div className='theia-header git-theia-header' key={group.id}>
                {`${group.label}`}
                {this.renderChangeCount(group.resources.length)}
            </div>
            <div>{group.resources.map(resource => this.renderScmItem(resource, group.provider.rootUri))}</div>
        </div>;
    }

    protected renderChangeCount(changes: number | undefined): React.ReactNode {
        if (changes) {
            return <div className='notification-count-container git-change-count'>
                <span className='notification-count'>{changes}</span>
            </div>;
        }
    }

    protected renderScmItem(resource: ScmResource, repoUri: string | undefined): React.ReactNode {
        if (!repoUri) {
            return undefined
        }
        const uri = resource.sourceUri.path.toString();
        return <ScmItem key={`${resource.sourceUri}`}
                        name={uri.substring(uri.lastIndexOf('/') + 1) + ' '}
                        path={uri.substring(uri.lastIndexOf(repoUri) + repoUri.length + 1, uri.lastIndexOf('/'))}
                        icon={`${(resource.decorations && resource.decorations.icon) ? resource.decorations.icon : ''}`}
                        color={`${(resource.decorations && resource.decorations.color) ? resource.decorations.color : ''}`}
                        letter={`${(resource.decorations && resource.decorations.letter) ? resource.decorations.letter : ''}`}
        />;
    }
}
