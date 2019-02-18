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
import {FrontendApplicationContribution} from '@theia/core/lib/browser';
import {injectable, named, inject} from 'inversify';
import {ContributionProvider} from '@theia/core';

export const ScmMenuContribution = Symbol('ScmMenuContribution');
export interface ScmMenuContribution {
    registerScmMenuItems(registry: ScmTitleRegistry): void;
}

interface ScmMenu {
    open(): void;
    id: string;
}

@injectable()
export class ScmTitleRegistry implements FrontendApplicationContribution {
    private items: Map<string, ScmMenu> = new Map();

    @inject(ContributionProvider)
    @named(ScmMenuContribution)
    protected readonly contributionProvider: ContributionProvider<ScmMenuContribution>;

    onStart(): void {
        const contributions = this.contributionProvider.getContributions();
        for (const contribution of contributions) {
            contribution.registerScmMenuItems(this);
        }
    }

    registerItem(item: ScmMenu): void {
        const id = item.id;
        if (this.items.has(id)) {
            throw new Error(`A toolbar item is already registered with the '${id}' ID.`);
        }
        this.items.set(id, item);
    }
}
