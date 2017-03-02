'use strict';

const queue = [];
let processing =  false;

function process(){
  if(queue.length == 0){
    processing = false;
    console.log('Queue: No more job to process');
  } else {
    const job = queue.shift();
    console.log('Queue: processing next data (%d jobs left)', queue.length);
    job.process(job.data)
      .then(
        (result) => {
          console.log('Queue: done processing data (%d jobs left)\n---', queue.length);
          process();
        },
        (err) => {
          console.log('Queue: error processing data:');
          console.error(err);
          console.log('---');
          process();
        }
      );
  }
}

module.exports = {
  processJob: (job) => {
    // job is a JSON object of the shape { data, process }
    queue.push(job);
    if(processing){
      return;
    }
    processing = true;
    process();
  }
};
