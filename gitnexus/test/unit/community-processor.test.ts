import { describe, it, expect } from 'vitest';
import { getCommunityColor, COMMUNITY_COLORS, processCommunities } from '../../src/core/ingestion/community-processor.js';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';

describe('community-processor', () => {
  describe('COMMUNITY_COLORS', () => {
    it('has 12 colors', () => {
      expect(COMMUNITY_COLORS).toHaveLength(12);
    });

    it('contains valid hex color strings', () => {
      for (const color of COMMUNITY_COLORS) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    it('has no duplicate colors', () => {
      const unique = new Set(COMMUNITY_COLORS);
      expect(unique.size).toBe(COMMUNITY_COLORS.length);
    });
  });

  describe('getCommunityColor', () => {
    it('returns first color for index 0', () => {
      expect(getCommunityColor(0)).toBe(COMMUNITY_COLORS[0]);
    });

    it('wraps around when index exceeds color count', () => {
      expect(getCommunityColor(12)).toBe(COMMUNITY_COLORS[0]);
      expect(getCommunityColor(13)).toBe(COMMUNITY_COLORS[1]);
    });

    it('returns different colors for different indices', () => {
      const c0 = getCommunityColor(0);
      const c1 = getCommunityColor(1);
      expect(c0).not.toBe(c1);
    });
  });

  describe('processCommunities', () => {
    const buildGraph = (nodeOrder: string[]) => {
      const graph = createKnowledgeGraph();
      const nodeDefs = new Map([
        ['alphaOne', { id: 'Method:src/alpha/one.ts:alphaOne:1', name: 'alphaOne', filePath: 'src/alpha/one.ts' }],
        ['alphaTwo', { id: 'Method:src/alpha/two.ts:alphaTwo:1', name: 'alphaTwo', filePath: 'src/alpha/two.ts' }],
        ['betaOne', { id: 'Method:src/beta/one.ts:betaOne:1', name: 'betaOne', filePath: 'src/beta/one.ts' }],
        ['betaTwo', { id: 'Method:src/beta/two.ts:betaTwo:1', name: 'betaTwo', filePath: 'src/beta/two.ts' }],
      ]);

      for (const key of nodeOrder) {
        const node = nodeDefs.get(key)!;
        graph.addNode({
          id: node.id,
          label: 'Method',
          properties: {
            name: node.name,
            filePath: node.filePath,
          },
        });
      }

      const addCall = (source: string, target: string) => {
        const sourceId = nodeDefs.get(source)!.id;
        const targetId = nodeDefs.get(target)!.id;
        graph.addRelationship({
          id: `CALLS:${sourceId}->${targetId}`,
          sourceId,
          targetId,
          type: 'CALLS',
          confidence: 1,
          reason: 'test',
        });
      };

      addCall('alphaOne', 'alphaTwo');
      addCall('alphaTwo', 'betaOne');
      addCall('betaOne', 'betaTwo');
      addCall('betaTwo', 'alphaOne');
      addCall('alphaOne', 'betaOne');
      addCall('alphaTwo', 'betaTwo');

      return graph;
    };

    const normalizeResult = async (nodeOrder: string[]) => {
      const result = await processCommunities(buildGraph(nodeOrder));
      return {
        communities: result.communities
          .map((community) => ({
            id: community.id,
            label: community.label,
            symbolCount: community.symbolCount,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        memberships: result.memberships
          .map((membership) => ({
            nodeId: membership.nodeId,
            communityId: membership.communityId,
          }))
          .sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.communityId.localeCompare(b.communityId)),
      };
    };

    it('produces stable communities regardless of insertion order', async () => {
      const forward = await normalizeResult(['alphaOne', 'alphaTwo', 'betaOne', 'betaTwo']);
      const reverse = await normalizeResult(['betaTwo', 'betaOne', 'alphaTwo', 'alphaOne']);

      expect(forward).toEqual(reverse);
      expect(forward.communities[0]?.label).toBe('Alpha');
    });
  });
});
