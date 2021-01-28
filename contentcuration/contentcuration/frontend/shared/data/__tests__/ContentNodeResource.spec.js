import sortBy from 'lodash/sortBy';
import shuffle from 'lodash/shuffle';
import find from 'lodash/find';
import {
  RELATIVE_TREE_POSITIONS,
  COPYING_FLAG,
  TASK_ID,
  CHANGES_TABLE,
  CHANGE_TYPES,
} from 'shared/data/constants';
import db, { CLIENTID } from 'shared/data/db';
import { ContentNode, ContentNodePrerequisite, uuid4 } from 'shared/data/resources';

describe('ContentNode methods', () => {
  const mocks = [];
  afterEach(() => {
    while (mocks.length) {
      mocks.pop().mockRestore();
    }
    return ContentNode.table.clear();
  });

  function mockMethod(name, implementation) {
    const mock = jest.spyOn(ContentNode, name).mockImplementation(implementation);
    mocks.push(mock);
    return mock;
  }

  function mockProperty(name, returnValue) {
    const mock = jest.spyOn(ContentNode, name, 'get').mockImplementation(() => returnValue);
    mocks.push(mock);
    return mock;
  }

  describe('resolveParent method', () => {
    let node,
      parent,
      get,
      nodes = [];
    beforeEach(() => {
      parent = { id: uuid4(), title: 'Test node parent' };
      node = { id: uuid4(), parent: parent.id, title: 'Test node' };
      nodes = [node, parent];
      get = mockMethod('get', id => {
        return Promise.resolve(find(nodes, ['id', id]));
      });
    });

    it('should reject invalid positions', () => {
      return expect(ContentNode.resolveParent('abc123', 'not-a-valid-position')).rejects.toThrow(
        `"not-a-valid-position" is an invalid position`
      );
    });

    it('should return target node when first child', async () => {
      await expect(
        ContentNode.resolveParent(node.id, RELATIVE_TREE_POSITIONS.FIRST_CHILD)
      ).resolves.toBe(node);
      expect(get).toHaveBeenCalledWith(node.id);
    });

    it('should return target node when last child', async () => {
      await expect(
        ContentNode.resolveParent(node.id, RELATIVE_TREE_POSITIONS.LAST_CHILD)
      ).resolves.toBe(node);
      expect(get).toHaveBeenCalledWith(node.id);
    });

    it("should return target node's parent when inserting after", async () => {
      await expect(ContentNode.resolveParent(node.id, RELATIVE_TREE_POSITIONS.RIGHT)).resolves.toBe(
        parent
      );
      expect(get).toHaveBeenNthCalledWith(1, node.id);
      expect(get).toHaveBeenNthCalledWith(2, parent.id);
    });

    it("should return target node's parent when inserting before", async () => {
      await expect(ContentNode.resolveParent(node.id, RELATIVE_TREE_POSITIONS.LEFT)).resolves.toBe(
        parent
      );
      expect(get).toHaveBeenNthCalledWith(1, node.id);
      expect(get).toHaveBeenNthCalledWith(2, parent.id);
    });

    it("should reject when the target can't be found", async () => {
      nodes = [];
      await expect(
        ContentNode.resolveParent(node.id, RELATIVE_TREE_POSITIONS.FIRST_CHILD)
      ).rejects.toThrow(`Target ${node.id} does not exist`);
      expect(get).toHaveBeenNthCalledWith(1, node.id);
    });

    it("should reject when the target's parent can't be found", async () => {
      nodes = [node];
      await expect(
        ContentNode.resolveParent(node.id, RELATIVE_TREE_POSITIONS.LEFT)
      ).rejects.toThrow(`Target ${parent.id} does not exist`);
      expect(get).toHaveBeenNthCalledWith(1, node.id);
      expect(get).toHaveBeenNthCalledWith(2, parent.id);
    });
  });

  describe('resolveTreeInsert method', () => {
    let node,
      parent,
      lft,
      siblings = [],
      resolveParent,
      treeLock,
      get,
      where,
      getNewSortOrder;
    beforeEach(() => {
      node = { id: uuid4(), title: 'Test node' };
      parent = {
        id: uuid4(),
        title: 'Test node parent',
        root_id: uuid4(),
      };
      siblings = [];
      resolveParent = mockMethod('resolveParent', () => Promise.resolve(parent));
      treeLock = mockMethod('treeLock', (id, cb) => cb());
      getNewSortOrder = mockMethod('getNewSortOrder', () => lft);
      get = mockMethod('get', () => Promise.resolve(node));
      where = mockMethod('where', () => Promise.resolve(siblings));
    });

    it('should reject with error when attempting to set as child of itself', async () => {
      parent.id = 'abc123';
      await expect(
        ContentNode.resolveTreeInsert('abc123', 'target', 'position', false, jest.fn())
      ).rejects.toThrow('Cannot set node as child of itself');
      expect(resolveParent).toHaveBeenCalledWith('target', 'position');
    });

    describe('moving', () => {
      it('should default to appending', async () => {
        let cb = jest.fn(() => Promise.resolve('results'));
        await expect(
          ContentNode.resolveTreeInsert('abc123', 'target', 'position', false, cb)
        ).resolves.toEqual('results');
        expect(resolveParent).toHaveBeenCalledWith('target', 'position');
        expect(treeLock).toHaveBeenCalledWith(parent.root_id, expect.any(Function));
        expect(get).toHaveBeenCalledWith('abc123');
        expect(where).toHaveBeenCalledWith({ parent: parent.id });
        expect(getNewSortOrder).not.toBeCalled();
        expect(cb).toBeCalled();
        const result = cb.mock.calls[0][0];
        expect(result).toMatchObject({
          node,
          parent,
          payload: {
            id: 'abc123',
            parent: parent.id,
            lft: 1,
            changed: true,
          },
          change: {
            key: 'abc123',
            from_key: null,
            target: parent.id,
            position: RELATIVE_TREE_POSITIONS.LAST_CHILD,
            oldObj: node,
            source: CLIENTID,
            table: 'contentnode',
            type: CHANGE_TYPES.MOVED,
          },
        });
      });

      it('should determine lft from siblings', async () => {
        let cb = jest.fn(() => Promise.resolve('results'));
        lft = 7;
        let sortedSiblings = Array(6)
          .fill(1)
          .map((_, i) => ({ id: uuid4(), lft: i, title: `Sibling ${i}` }));
        siblings = shuffle(sortedSiblings);

        await expect(
          ContentNode.resolveTreeInsert('abc123', 'target', 'position', false, cb)
        ).resolves.toEqual('results');
        expect(resolveParent).toHaveBeenCalledWith('target', 'position');
        expect(treeLock).toHaveBeenCalledWith(parent.root_id, expect.any(Function));
        expect(get).toHaveBeenCalledWith('abc123');
        expect(where).toHaveBeenCalledWith({ parent: parent.id });
        expect(getNewSortOrder).toHaveBeenCalledWith(
          'abc123',
          'target',
          'position',
          sortedSiblings
        );
        expect(cb).toBeCalled();
        const result = cb.mock.calls[0][0];
        expect(result).toMatchObject({
          node,
          parent,
          payload: {
            id: 'abc123',
            parent: parent.id,
            lft,
            changed: true,
          },
          change: {
            key: 'abc123',
            from_key: null,
            target: 'target',
            position: 'position',
            oldObj: node,
            source: CLIENTID,
            table: 'contentnode',
            type: CHANGE_TYPES.MOVED,
          },
        });
      });

      it('should reject if null lft', async () => {
        lft = null;
        let cb = jest.fn(() => Promise.resolve('results'));
        siblings = Array(5)
          .fill(1)
          .map((_, i) => ({ id: uuid4(), title: `Sibling ${i}` }));
        await expect(
          ContentNode.resolveTreeInsert('abc123', 'target', 'position', false, cb)
        ).rejects.toThrow('New lft value evaluated to null');
        expect(resolveParent).toHaveBeenCalledWith('target', 'position');
        expect(treeLock).toHaveBeenCalledWith(parent.root_id, expect.any(Function));
        expect(get).toHaveBeenCalledWith('abc123');
        expect(where).toHaveBeenCalledWith({ parent: parent.id });
        expect(getNewSortOrder).toHaveBeenCalledWith('abc123', 'target', 'position', siblings);
        expect(cb).not.toBeCalled();
      });
    });

    describe('copying', () => {
      it('should default to appending', async () => {
        let cb = jest.fn(() => Promise.resolve('results'));
        await expect(
          ContentNode.resolveTreeInsert('abc123', 'target', 'position', true, cb)
        ).resolves.toEqual('results');
        expect(resolveParent).toHaveBeenCalledWith('target', 'position');
        expect(treeLock).toHaveBeenCalledWith(parent.root_id, expect.any(Function));
        expect(get).toHaveBeenCalledWith('abc123');
        expect(where).toHaveBeenCalledWith({ parent: parent.id });
        expect(getNewSortOrder).not.toBeCalled();
        expect(cb).toBeCalled();
        const result = cb.mock.calls[0][0];
        expect(result).toMatchObject({
          node,
          parent,
          payload: {
            id: expect.not.stringMatching('abc123'),
            parent: parent.id,
            lft: 1,
            changed: true,
          },
          change: {
            key: expect.not.stringMatching('abc123'),
            from_key: 'abc123',
            target: parent.id,
            position: RELATIVE_TREE_POSITIONS.LAST_CHILD,
            oldObj: null,
            source: CLIENTID,
            table: 'contentnode',
            type: CHANGE_TYPES.COPIED,
          },
        });
        expect(result.payload.id).toEqual(result.change.key);
      });

      it('should determine lft from siblings', async () => {
        let cb = jest.fn(() => Promise.resolve('results'));
        lft = 7;
        siblings = Array(5)
          .fill(1)
          .map((_, i) => ({ id: uuid4(), title: `Sibling ${i}` }));
        await expect(
          ContentNode.resolveTreeInsert('abc123', 'target', 'position', true, cb)
        ).resolves.toEqual('results');
        expect(resolveParent).toHaveBeenCalledWith('target', 'position');
        expect(treeLock).toHaveBeenCalledWith(parent.root_id, expect.any(Function));
        expect(get).toHaveBeenCalledWith('abc123');
        expect(where).toHaveBeenCalledWith({ parent: parent.id });
        expect(getNewSortOrder).toHaveBeenCalledWith(null, 'target', 'position', siblings);
        expect(cb).toBeCalled();
        const result = cb.mock.calls[0][0];
        expect(result).toMatchObject({
          node,
          parent,
          payload: {
            id: expect.not.stringMatching('abc123'),
            parent: parent.id,
            lft,
            changed: true,
          },
          change: {
            key: expect.not.stringMatching('abc123'),
            from_key: 'abc123',
            target: 'target',
            position: 'position',
            oldObj: null,
            source: CLIENTID,
            table: 'contentnode',
            type: CHANGE_TYPES.COPIED,
          },
        });
        expect(result.payload.id).toEqual(result.change.key);
      });

      it('should reject if null lft', async () => {
        lft = null;
        let cb = jest.fn(() => Promise.resolve('results'));
        siblings = Array(5)
          .fill(1)
          .map((_, i) => ({ id: uuid4(), title: `Sibling ${i}` }));
        await expect(
          ContentNode.resolveTreeInsert('abc123', 'target', 'position', true, cb)
        ).rejects.toThrow('New lft value evaluated to null');
        expect(resolveParent).toHaveBeenCalledWith('target', 'position');
        expect(treeLock).toHaveBeenCalledWith(parent.root_id, expect.any(Function));
        expect(get).toHaveBeenCalledWith('abc123');
        expect(where).toHaveBeenCalledWith({ parent: parent.id });
        expect(getNewSortOrder).toHaveBeenCalledWith(null, 'target', 'position', siblings);
        expect(cb).not.toBeCalled();
      });
    });
  });

  describe('tableMove method', () => {
    let node,
      oldParent,
      parent,
      payload,
      change,
      updated = true,
      table = {};

    beforeEach(() => {
      table = {
        update: jest.fn(() => Promise.resolve(updated)),
        put: jest.fn(() => Promise.resolve()),
      };
      updated = true;
      oldParent = { id: uuid4(), title: 'Parent' };
      parent = { id: uuid4(), root_id: uuid4(), title: 'Parent' };
      node = { id: uuid4(), parent: oldParent.id, title: 'Source node' };
      payload = { id: uuid4(), parent: parent.id, changed: true, lft: 1, title: 'Payload' };
      change = {
        key: payload.id,
        from_key: null,
        target: parent.id,
        position: RELATIVE_TREE_POSITIONS.LAST_CHILD,
        oldObj: node,
        source: CLIENTID,
        table: 'contentnode',
        type: CHANGE_TYPES.MOVED,
      };

      mockProperty('table', table);
    });

    it('should update the node with the payload', async () => {
      node.parent = parent.id;
      await expect(ContentNode.tableMove({ node, parent, payload, change })).resolves.toBe(payload);
      expect(table.update).toHaveBeenCalledWith(node.id, payload);
      expect(table.put).not.toBeCalled();
      expect(table.update).not.toHaveBeenCalledWith(node.parent, { changed: true });
    });

    it('should put the node if not updated', async () => {
      node.parent = parent.id;
      updated = false;
      const newPayload = { ...payload, root_id: parent.root_id };
      await expect(ContentNode.tableMove({ node, parent, payload, change })).resolves.toMatchObject(
        newPayload
      );
      expect(table.update).toHaveBeenCalledWith(node.id, payload);
      expect(table.put).toHaveBeenCalledWith(newPayload);
      expect(table.update).not.toHaveBeenCalledWith(node.parent, { changed: true });
    });

    it('should mark the old parent as changed', async () => {
      await expect(ContentNode.tableMove({ node, parent, payload, change })).resolves.toMatchObject(
        payload
      );
      expect(table.update).toHaveBeenCalledWith(node.id, payload);
      expect(table.put).not.toBeCalled();
      expect(table.update).toHaveBeenCalledWith(node.parent, { changed: true });
    });

    // TODO: the second assertion is failing saying it resolved with undefined
    it.skip('should add a change record', async () => {
      await expect(ContentNode.tableMove({ node, parent, payload, change })).resolves.toBe(payload);
      await expect(
        db[CHANGES_TABLE].get({ '[table+key]': [ContentNode.tableName, node.id] })
      ).resolves.toMatchObject(change);
    });
  });

  describe('tableCopy method', () => {
    let node,
      parent,
      payload,
      change,
      table = {};

    beforeEach(() => {
      table = {
        put: jest.fn(() => Promise.resolve()),
      };
      parent = {
        id: uuid4(),
        title: 'Parent',
        root_id: uuid4(),
        channel_id: uuid4(),
        node_id: uuid4(),
      };
      node = {
        id: uuid4(),
        title: 'Source node',
        root_id: uuid4(),
        channel_id: uuid4(),
        parent: uuid4(),
        source_node_id: uuid4(),
        original_source_node_id: uuid4(),
        node_id: uuid4(),
      };
      payload = { id: uuid4(), parent: parent.id, changed: true, lft: 1 };
      change = {
        key: payload.id,
        from_key: node.id,
        target: parent.id,
        position: RELATIVE_TREE_POSITIONS.LAST_CHILD,
        oldObj: null,
        source: CLIENTID,
        table: 'contentnode',
        type: CHANGE_TYPES.COPIED,
      };

      mockProperty('table', table);
    });

    it('should put the node copy appropriate payload', async () => {
      const expectedPayload = {
        id: payload.id,
        title: node.title,
        changed: true,
        published: false,
        parent: parent.id,
        lft: 1,
        node_id: expect.not.stringMatching(new RegExp(`${node.node_id}|${parent.node_id}`)),
        original_source_node_id: node.original_source_node_id,
        source_channel_id: node.channel_id,
        source_node_id: node.node_id,
        channel_id: parent.channel_id,
        root_id: parent.root_id,
        [COPYING_FLAG]: true,
        [TASK_ID]: null,
      };
      await expect(ContentNode.tableCopy({ node, parent, payload, change })).resolves.toMatchObject(
        expectedPayload
      );
      expect(table.put).toHaveBeenCalledWith(expectedPayload);
      // TODO: Fails
      // await expect(db[CHANGES_TABLE].get({ '[table+key]': [ContentNode.tableName, node.id] }))
      //   .resolves.toMatchObject(change);
    });
  });
});

describe('ContentNodePrerequisite methods', () => {
  const mappings = [
    { target_node: 'id-integrals', prerequisite: 'id-elementary-math' },
    { target_node: 'id-elementary-math', prerequisite: 'id-reading' },
    { target_node: 'id-physics', prerequisite: 'id-integrals' },
    { target_node: 'id-astronomy', prerequisite: 'id-physics' },
    { target_node: 'id-spaceships-contruction', prerequisite: 'id-astronomy' },
    { target_node: 'id-chemistry', prerequisite: 'id-integrals' },
    { target_node: 'id-lab', prerequisite: 'id-chemistry' },
  ];
  let spy;
  beforeEach(() => {
    spy = jest
      .spyOn(ContentNode, 'fetchRequisites')
      .mockImplementation(() => Promise.resolve(mappings));
    return ContentNodePrerequisite.table.bulkPut(mappings);
  });
  afterEach(() => {
    spy.mockRestore();
    return ContentNodePrerequisite.table.clear();
  });
  describe('getRequisites method', () => {
    it('should return all associated requisites', () => {
      return ContentNode.getRequisites('id-integrals').then(entries => {
        expect(sortBy(entries, 'target_node')).toEqual(sortBy(mappings, 'target_node'));
        expect(spy).toHaveBeenCalled();
      });
    });
    it('should return all associated requisites, even when there is a cyclic dependency', () => {
      const cyclic = { target_node: 'id-chemistry', prerequisite: 'id-lab' };
      return ContentNodePrerequisite.put(cyclic).then(() => {
        return ContentNode.getRequisites('id-integrals').then(entries => {
          expect(sortBy(entries, 'target_node')).toEqual(
            sortBy(mappings.concat([cyclic]), 'target_node')
          );
        });
      });
    });
    it('should return all associated requisites from the backend', () => {
      return ContentNodePrerequisite.table.clear().then(() => {
        return ContentNode.getRequisites('id-integrals').then(entries => {
          expect(sortBy(entries, 'target_node')).toEqual(sortBy(mappings, 'target_node'));
          expect(spy).toHaveBeenCalled();
        });
      });
    });
  });
});
