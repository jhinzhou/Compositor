/** Serial, latest-only preview scheduler. It never mutates document/history or owns a user interaction lease. */
export class RasterStrokePreview<Input,Output> {
 private generation=0
 private next?:{input:Input;ticket:number}
 private running=false
 private canceled=false
 /** A stroke's random seed remains fixed across previews and the final commit. */
 readonly seed:number
 constructor(private readonly render:(input:Input,requestId:number)=>Promise<Output>,private readonly publish:(output:Output,requestId:number)=>void,private readonly failure?:(error:unknown)=>void,seed=Math.floor(Math.random()*0x1_0000_0000)) {this.seed=seed>>>0}
 update(input:Input):number {
  if(this.canceled)return this.generation
  const ticket=++this.generation
  this.next={input,ticket}
  void this.pump()
  return ticket
 }
 private async pump():Promise<void> {
  if(this.running||this.canceled)return
  this.running=true
  try{
   while(this.next&&!this.canceled){
    const current=this.next;this.next=undefined
    try{const output=await this.render(current.input,current.ticket);if(!this.canceled&&current.ticket===this.generation)this.publish(output,current.ticket)}
    catch(error){if(!this.canceled&&current.ticket===this.generation)this.failure?.(error)}
   }
  }finally{this.running=false}
 }
 /** Includes any queued points; callers may await final draft completion before committing. */
 get pending():boolean{return !this.canceled&&(this.running||!!this.next)}
 /** Drop a draft generation while keeping the scheduler available for reopening. */
 invalidate():void {this.generation++;this.next=undefined}
 cancel():void {this.canceled=true;this.generation++;this.next=undefined}
}
