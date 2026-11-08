// Every tab but its first lines sits behind one More fold (fold-more, fold-more-git, …): opens the one on screen
export const openMore = async (ui: any) => {
  const m = /"key":"(fold-more[-\w]*)"[^]*?› More/.exec(JSON.stringify(await ui.drawn()))
  if (m) await ui.press({ key: m[1] })
}
