/* 视图与主入口之间的导航总线（避免循环依赖；main 启动时注入实现） */

export const navBus = { nav: null, rerender: null };

export function nav(route){
  if(navBus.nav) navBus.nav(route);
  else location.hash = '#/' + route;
}

export function rerender(keepScroll){
  if(navBus.rerender) navBus.rerender(keepScroll);
}
