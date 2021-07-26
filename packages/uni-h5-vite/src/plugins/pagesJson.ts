import path from 'path'
import { Plugin, ResolvedConfig } from 'vite'
import {
  API_DEPS_CSS,
  FEATURE_DEFINES,
  H5_FRAMEWORK_STYLE_PATH,
  BASE_COMPONENTS_STYLE_PATH,
  normalizeIdentifier,
  normalizePagesJson,
  defineUniPagesJsonPlugin,
  normalizePagesRoute,
  normalizePagePath,
  normalizePath,
} from '@dcloudio/uni-cli-shared'

const pkg = require('@dcloudio/vite-plugin-uni/package.json')

export function uniPagesJsonPlugin(): Plugin {
  return defineUniPagesJsonPlugin((opts) => {
    return {
      name: 'vite:uni-h5-pages-json',
      enforce: 'pre',
      transform(code, id, ssr) {
        if (opts.filter(id)) {
          const { resolvedConfig } = opts
          return {
            code:
              registerGlobalCode(resolvedConfig, ssr) +
              generatePagesJsonCode(ssr, code, resolvedConfig),
            map: { mappings: '' },
          }
        }
      },
    }
  })
}

function generatePagesJsonCode(
  ssr: boolean | undefined,
  jsonStr: string,
  config: ResolvedConfig
) {
  const globalName = getGlobal(ssr)
  const pagesJson = normalizePagesJson(jsonStr, process.env.UNI_PLATFORM)
  const { importLayoutComponentsCode, defineLayoutComponentsCode } =
    generateLayoutComponentsCode(globalName, pagesJson)
  const definePagesCode = generatePagesDefineCode(pagesJson, config)
  const uniRoutesCode = generateRoutes(globalName, pagesJson, config)
  const uniConfigCode = generateConfig(globalName, pagesJson, config)
  const manifestJsonPath = normalizePath(
    path.resolve(process.env.UNI_INPUT_DIR, 'manifest.json.js')
  )
  const cssCode = generateCssCode(config)

  return `
import { defineAsyncComponent, resolveComponent, createVNode, withCtx, openBlock, createBlock } from 'vue'
import { PageComponent, AsyncLoadingComponent, AsyncErrorComponent } from '@dcloudio/uni-h5'
import { appid, debug, networkTimeout, router, async, sdkConfigs, qqMapKey, nvue } from '${manifestJsonPath}'
${importLayoutComponentsCode}
const extend = Object.assign
${cssCode}
${uniConfigCode}
${defineLayoutComponentsCode}
${definePagesCode}
${uniRoutesCode}
${config.command === 'serve' ? hmrCode : ''}
export {}
`
}

const hmrCode = `if(import.meta.hot){
  import.meta.hot.on('invalidate', (data) => {
      import.meta.hot.invalidate()
  })
}`

function getGlobal(ssr?: boolean) {
  return ssr ? 'global' : 'window'
}

function registerGlobalCode(config: ResolvedConfig, ssr?: boolean) {
  const name = getGlobal(ssr)
  if (config.command === 'build' && !ssr) {
    // 非SSR的发行模式，补充全局 uni 对象
    return `${name}.uni = {}`
  }

  const rpx2pxCode =
    !ssr && config.define!.__UNI_FEATURE_RPX__
      ? `import {upx2px} from '@dcloudio/uni-h5'
  ${name}.rpx2px = upx2px
`
      : ''
  return `${rpx2pxCode}
import {uni,getCurrentPages,getApp,UniServiceJSBridge,UniViewJSBridge} from '@dcloudio/uni-h5'
${name}.getApp = getApp
${name}.getCurrentPages = getCurrentPages
${name}.uni = uni
${name}.UniViewJSBridge = UniViewJSBridge
${name}.UniServiceJSBridge = UniServiceJSBridge
`
}

function generateCssCode(config: ResolvedConfig) {
  const define = config.define! as FEATURE_DEFINES
  const cssFiles = [H5_FRAMEWORK_STYLE_PATH + 'base.css']
  // if (define.__UNI_FEATURE_PAGES__) {
  cssFiles.push(H5_FRAMEWORK_STYLE_PATH + 'async.css')
  // }
  if (define.__UNI_FEATURE_RESPONSIVE__) {
    cssFiles.push(H5_FRAMEWORK_STYLE_PATH + 'layout.css')
  }
  if (define.__UNI_FEATURE_NAVIGATIONBAR__) {
    cssFiles.push(H5_FRAMEWORK_STYLE_PATH + 'pageHead.css')
  }
  if (define.__UNI_FEATURE_TABBAR__) {
    cssFiles.push(H5_FRAMEWORK_STYLE_PATH + 'tabBar.css')
  }
  if (define.__UNI_FEATURE_NVUE__) {
    cssFiles.push(H5_FRAMEWORK_STYLE_PATH + 'nvue.css')
  }
  if (define.__UNI_FEATURE_PULL_DOWN_REFRESH__) {
    cssFiles.push(H5_FRAMEWORK_STYLE_PATH + 'pageRefresh.css')
  }
  if (define.__UNI_FEATURE_NAVIGATIONBAR_SEARCHINPUT__) {
    cssFiles.push(BASE_COMPONENTS_STYLE_PATH + 'input.css')
  }
  if (config.command === 'serve') {
    // 开发模式，自动添加所有API相关css
    Object.keys(API_DEPS_CSS).forEach((name) => {
      const styles = API_DEPS_CSS[name as keyof typeof API_DEPS_CSS]
      styles.forEach((style) => {
        if (!cssFiles.includes(style)) {
          cssFiles.push(style)
        }
      })
    })
  }
  return cssFiles.map((file) => `import '${file}'`).join('\n')
}

function generateLayoutComponentsCode(
  globalName: string,
  pagesJson: UniApp.PagesJson
) {
  const windowNames: Array<'topWindow' | 'leftWindow' | 'rightWindow'> = [
    'topWindow',
    'leftWindow',
    'rightWindow',
  ]
  let importLayoutComponentsCode = ''
  let defineLayoutComponentsCode = `${globalName}.__uniLayout = ${globalName}.__uniLayout || {}\n`
  windowNames.forEach((name) => {
    const windowConfig = pagesJson[name]
    if (windowConfig && windowConfig.path) {
      importLayoutComponentsCode += `import ${name} from './${windowConfig.path}'\n`
      defineLayoutComponentsCode += `${globalName}.__uniConfig.${name}.component = ${name}\n`
    }
  })

  return {
    importLayoutComponentsCode,
    defineLayoutComponentsCode,
  }
}

function generatePageDefineCode(pageOptions: UniApp.PagesJsonPageOptions) {
  let pagePathWithExtname = normalizePagePath(pageOptions.path, 'h5')
  if (!pagePathWithExtname) {
    // 不存在时，仍引用，此时编译会报错文件不存在
    pagePathWithExtname = pageOptions.path + '.vue'
  }
  const pageIdent = normalizeIdentifier(pageOptions.path)
  return `const ${pageIdent}Loader = ()=>import('./${pagePathWithExtname}?mpType=page')
const ${pageIdent} = defineAsyncComponent(extend({loader:${pageIdent}Loader},AsyncComponentOptions))`
}

function generatePagesDefineCode(
  pagesJson: UniApp.PagesJson,
  _config: ResolvedConfig
) {
  const { pages } = pagesJson
  return (
    `const AsyncComponentOptions = {
  loadingComponent: AsyncLoadingComponent,
  errorComponent: AsyncErrorComponent,
  delay: async.delay,
  timeout: async.timeout,
  suspensible: async.suspensible
}
` + pages.map((pageOptions) => generatePageDefineCode(pageOptions)).join('\n')
  )
}

function generatePageRoute(
  { path, meta }: UniApp.UniRoute,
  _config: ResolvedConfig
) {
  const { isEntry } = meta
  const alias = isEntry ? `\n  alias:'/${path}',` : ''
  return `{
  path:'/${isEntry ? '' : path}',${alias}
  component:{setup(){return ()=>renderPage(${normalizeIdentifier(path)})}},
  loader: ${normalizeIdentifier(path)}Loader,
  meta: ${JSON.stringify(meta)}
}`
}

function generatePagesRoute(
  pagesRouteOptions: UniApp.UniRoute[],
  config: ResolvedConfig
) {
  return pagesRouteOptions.map((pageOptions) =>
    generatePageRoute(pageOptions, config)
  )
}

function generateRoutes(
  globalName: string,
  pagesJson: UniApp.PagesJson,
  config: ResolvedConfig
) {
  return `
function renderPage(component){
  return (openBlock(), createBlock(PageComponent, null, {page: withCtx(() => [createVNode(component, { ref: "page" }, null, 512 /* NEED_PATCH */)]), _: 1 /* STABLE */}))
}
${globalName}.__uniRoutes=[${[
    ...generatePagesRoute(normalizePagesRoute(pagesJson), config),
  ].join(
    ','
  )}].map(uniRoute=>(uniRoute.meta.route = (uniRoute.alias || uniRoute.path).substr(1),uniRoute))`
}

function generateConfig(
  globalName: string,
  pagesJson: Record<string, any>,
  config: ResolvedConfig
) {
  delete pagesJson.pages
  delete pagesJson.subPackages
  delete pagesJson.subpackages
  pagesJson.compilerVersion = pkg['uni-app'].compilerVersion
  return (
    (config.command === 'serve'
      ? ''
      : `${globalName}['____'+appid+'____']=true
delete ${globalName}['____'+appid+'____']
`) +
    `${globalName}.__uniConfig=extend(${JSON.stringify(pagesJson)},{
  async,
  debug,
  networkTimeout,
  sdkConfigs,
  qqMapKey,
  nvue,
  router
})
`
  )
}
