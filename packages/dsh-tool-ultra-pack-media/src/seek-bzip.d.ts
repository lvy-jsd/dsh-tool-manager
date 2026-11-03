declare module 'seek-bzip' {
  const Bunzip: { decode(input: Buffer): Buffer }
  export default Bunzip
}
