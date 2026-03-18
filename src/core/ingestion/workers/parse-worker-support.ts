import Parser from 'tree-sitter';
import { SupportedLanguages } from '../../../config/supported-languages.js';
import { generateId } from '../../../lib/utils.js';
import { BUILT_IN_NAMES } from '../call-noise.js';
import { appendLuauModuleSymbols, createDefinitionArtifacts } from '../parsing-symbol-support.js';
import { extractLuauRobloxAliasesAndImports } from '../roblox/luau-resolution.js';
import {
  extractEloquentRelationDescription,
  extractLaravelRoutes,
  extractPhpPropertyDescription,
} from './parse-worker-php-support.js';
import type { ParseWorkerInput, ParseWorkerResult } from './parse-worker-types.js';

const FUNCTION_NODE_TYPES = new Set([
  'function_declaration', 'arrow_function', 'function_expression',
  'method_definition', 'generator_function_declaration',
  'function_definition', 'async_function_declaration', 'async_arrow_function',
  'method_declaration', 'constructor_declaration',
  'local_function_statement', 'function_item', 'impl_item',
  'lambda_literal', 'anonymous_function',
  'init_declaration', 'deinit_declaration',
]);

export const appendKotlinWildcard = (importPath: string, importNode: any): string => {
  for (let i = 0; i < importNode.childCount; i++) {
    if (importNode.child(i)?.type === 'wildcard_import') {
      return importPath.endsWith('.*') ? importPath : `${importPath}.*`;
    }
  }
  return importPath;
};

const findEnclosingFunctionId = (node: any, filePath: string): string | null => {
  let current = node.parent;
  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) {
      let funcName: string | null = null;
      let label = 'Function';

      if (current.type === 'init_declaration' || current.type === 'deinit_declaration') {
        const initName = current.type === 'init_declaration' ? 'init' : 'deinit';
        return generateId('Constructor', `${filePath}:${initName}:${current.startPosition?.row ?? 0}`);
      }

      if (['function_declaration', 'async_function_declaration', 'generator_function_declaration', 'function_item'].includes(current.type)) {
        const nameNode = current.childForFieldName?.('name') ||
          current.children?.find((c: any) => c.type === 'identifier' || c.type === 'property_identifier');
        if (nameNode?.type === 'method_index_expression') {
          funcName = nameNode.childForFieldName?.('method')?.text ||
            nameNode.children?.find((c: any) => c.type === 'identifier')?.text;
          label = 'Method';
        } else if (nameNode?.type === 'dot_index_expression') {
          funcName = nameNode.childForFieldName?.('field')?.text ||
            nameNode.children?.find((c: any) => c.type === 'identifier')?.text;
          label = 'Method';
        } else {
          funcName = nameNode?.text;
        }
      } else if (current.type === 'impl_item') {
        const funcItem = current.children?.find((c: any) => c.type === 'function_item');
        if (funcItem) {
          const nameNode = funcItem.childForFieldName?.('name') ||
            funcItem.children?.find((c: any) => c.type === 'identifier');
          funcName = nameNode?.text;
          label = 'Method';
        }
      } else if (current.type === 'method_definition') {
        const nameNode = current.childForFieldName?.('name') ||
          current.children?.find((c: any) => c.type === 'property_identifier');
        funcName = nameNode?.text;
        label = 'Method';
      } else if (current.type === 'method_declaration' || current.type === 'constructor_declaration') {
        const nameNode = current.childForFieldName?.('name') ||
          current.children?.find((c: any) => c.type === 'identifier');
        funcName = nameNode?.text;
        label = 'Method';
      } else if (current.type === 'arrow_function' || current.type === 'function_expression') {
        const parent = current.parent;
        if (parent?.type === 'variable_declarator') {
          const nameNode = parent.childForFieldName?.('name') ||
            parent.children?.find((c: any) => c.type === 'identifier');
          funcName = nameNode?.text;
        }
      } else if (current.type === 'function_definition') {
        const expressionList = current.parent;
        const assignment = expressionList?.type === 'expression_list' ? expressionList.parent : null;
        const variableList = assignment?.children?.find((c: any) => c.type === 'variable_list');
        const assignedName = variableList?.childForFieldName?.('name') || variableList?.namedChild?.(0);
        if (assignedName?.type === 'identifier') {
          funcName = assignedName.text;
        } else if (assignedName?.type === 'dot_index_expression') {
          funcName = assignedName.childForFieldName?.('field')?.text ||
            assignedName.children?.find((c: any) => c.type === 'identifier')?.text;
          label = 'Method';
        } else if (assignedName?.type === 'method_index_expression') {
          funcName = assignedName.childForFieldName?.('method')?.text ||
            assignedName.children?.find((c: any) => c.type === 'identifier')?.text;
          label = 'Method';
        }
      }

      if (funcName) {
        const startLine = current.startPosition?.row ?? 0;
        return generateId(label, `${filePath}:${funcName}:${startLine}`);
      }
    }
    current = current.parent;
  }
  return null;
};

const resolveLuauModuleMethodId = (
  result: ParseWorkerResult,
  filePath: string,
  methodRef: { name: string; startLine: number; label: string; targetName?: string; targetLabel?: string },
): string | null => {
  if (methodRef.targetLabel) {
    const directId = generateId(
      methodRef.targetLabel,
      `${filePath}:${methodRef.targetName || methodRef.name}:${methodRef.startLine}`,
    );
    if (result.symbols.some((symbol) => symbol.filePath === filePath && symbol.nodeId === directId)) {
      return directId;
    }
  }

  const targetName = methodRef.targetName || methodRef.name;
  const exact = result.symbols.find(
    (symbol) =>
      symbol.filePath === filePath &&
      symbol.name === targetName &&
      (methodRef.targetLabel
        ? symbol.type === methodRef.targetLabel
        : symbol.type === 'Method' ||
          symbol.type === 'Function' ||
          symbol.type === 'Property' ||
          symbol.type === 'Const' ||
          symbol.type === 'Static' ||
          symbol.type === 'CodeElement'),
  );
  return exact?.nodeId ?? null;
};

export const processFileGroup = (
  files: ParseWorkerInput[],
  language: SupportedLanguages,
  queryString: string,
  parser: Parser,
  result: ParseWorkerResult,
  onFileProcessed?: () => void,
): void => {
  let query: any;
  try {
    query = new Parser.Query(parser.getLanguage(), queryString);
  } catch {
    return;
  }

  for (const file of files) {
    if (file.content.length > 512 * 1024) continue;

    let tree;
    try {
      tree = parser.parse(file.content, undefined, { bufferSize: 1024 * 256 });
    } catch {
      continue;
    }

    result.fileCount++;
    onFileProcessed?.();

    let matches;
    try {
      matches = query.matches(tree.rootNode);
    } catch {
      continue;
    }

    for (const match of matches) {
      const captureMap: Record<string, any> = {};
      for (const c of match.captures) {
        captureMap[c.name] = c.node;
      }

      if (captureMap.import && captureMap['import.source']) {
        if (language !== SupportedLanguages.Luau) {
          const rawImportPath =
            language === SupportedLanguages.Kotlin
              ? appendKotlinWildcard(captureMap['import.source'].text.replace(/['"<>]/g, ''), captureMap.import)
              : captureMap['import.source'].text.replace(/['"<>]/g, '');
          result.imports.push({
            filePath: file.path,
            rawImportPath,
            language,
          });
        }
        continue;
      }

      if (captureMap.call) {
        const callNameNode = captureMap['call.name'];
        if (callNameNode) {
          const calledName = callNameNode.text;
          if (!BUILT_IN_NAMES.has(calledName)) {
            const callNode = captureMap.call;
            const sourceId = findEnclosingFunctionId(callNode, file.path) || generateId('File', file.path);
            result.calls.push({ filePath: file.path, calledName, sourceId });
          }
        }
        continue;
      }

      if (captureMap['heritage.class']) {
        if (captureMap['heritage.extends']) {
          result.heritage.push({
            filePath: file.path,
            className: captureMap['heritage.class'].text,
            parentName: captureMap['heritage.extends'].text,
            kind: 'extends',
          });
        }
        if (captureMap['heritage.implements']) {
          result.heritage.push({
            filePath: file.path,
            className: captureMap['heritage.class'].text,
            parentName: captureMap['heritage.implements'].text,
            kind: 'implements',
          });
        }
        if (captureMap['heritage.trait']) {
          result.heritage.push({
            filePath: file.path,
            className: captureMap['heritage.class'].text,
            parentName: captureMap['heritage.trait'].text,
            kind: 'trait-impl',
          });
        }
        if (captureMap['heritage.extends'] || captureMap['heritage.implements'] || captureMap['heritage.trait']) {
          continue;
        }
      }

      const artifacts = createDefinitionArtifacts(
        captureMap,
        file.path,
        language,
        language === SupportedLanguages.PHP
          ? (definitionCaptureMap, nodeLabel, nodeName) => {
              if (nodeLabel === 'Property' && definitionCaptureMap['definition.property']) {
                return extractPhpPropertyDescription(nodeName, definitionCaptureMap['definition.property']) ?? undefined;
              }
              if (nodeLabel === 'Method' && definitionCaptureMap['definition.method']) {
                return extractEloquentRelationDescription(definitionCaptureMap['definition.method']) ?? undefined;
              }
              return undefined;
            }
          : undefined,
      );
      if (!artifacts) continue;

      result.nodes.push(artifacts.node);
      result.symbols.push(artifacts.symbol);
      result.relationships.push(artifacts.relationship);
    }

    if (
      language === SupportedLanguages.PHP &&
      ((file.path.includes('/routes/') || file.path.startsWith('routes/')) && file.path.endsWith('.php'))
    ) {
      result.routes.push(...extractLaravelRoutes(tree, file.path));
    }

    if (language === SupportedLanguages.Luau) {
      appendLuauModuleSymbols(tree.rootNode, file.path, {
        hasNode: (id) => result.symbols.some((symbol) => symbol.filePath === file.path && symbol.nodeId === id),
        addNode: (node) => result.nodes.push(node),
        addSymbol: (symbol) => result.symbols.push(symbol),
        addRelationship: (relationship) => result.relationships.push(relationship),
        resolveMemberId: (targetFilePath, memberRef) => resolveLuauModuleMethodId(result, targetFilePath, memberRef),
      });
      result.imports.push(...extractLuauRobloxAliasesAndImports(tree.rootNode, file.path));
    }
  }
};
